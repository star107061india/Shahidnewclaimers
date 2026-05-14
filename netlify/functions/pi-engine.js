const { Keypair, Horizon, TransactionBuilder, Operation, Asset, Memo } = require('stellar-sdk');
const { mnemonicToSeedSync } = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');

// 24-word phrase se real Pi Keypair nikalne ka formula
const createKeypairFromMnemonic = (mnemonic) => {
    try {
        const seed = mnemonicToSeedSync(mnemonic.trim());
        const derivedKey = derivePath("m/44'/314159'/0'", seed.toString('hex')).key;
        return Keypair.fromRawEd25519Seed(derivedKey);
    } catch (e) {
        // Agar kisine direct 'S' wali private key daali ho
        try { return Keypair.fromSecret(mnemonic.trim()); } 
        catch(err) { throw new Error("Invalid 24-word Passphrase or Secret Key."); }
    }
};

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const data = JSON.parse(event.body);
        const serverUrl = data.network === 'testnet' ? 'https://api.testnet.minepi.com' : 'https://api.mainnet.minepi.com';
        const networkPassphrase = data.network === 'testnet' ? 'Pi Testnet' : 'Pi Network';
        
        // Timeout kam rakha hai taaki fast kaam kare
        const server = new Horizon.Server(serverUrl, { httpClient: axios.create({ timeout: 15000 }) });

        // ===============================================
        // ACTION 1: FETCH WALLET DATA & UNLOCK TIME
        // ===============================================
        if (data.action === 'wallet_info') {
            const kp = createKeypairFromMnemonic(data.seed);
            const pubKey = kp.publicKey();
            let avail = "0.00", locked = "0.00", unlockTime = null;

            try {
                const account = await server.loadAccount(pubKey);
                account.balances.forEach(b => { if (b.asset_type === 'native') avail = b.balance; });
            } catch(e) {} // Unfunded account

            try {
                const claimables = await server.claimableBalances().claimant(pubKey).limit(100).call();
                if (claimables.records && claimables.records.length > 0) {
                    claimables.records.forEach(cb => {
                        locked = (parseFloat(locked) + parseFloat(cb.amount)).toFixed(7);
                        // Fetch the exact unlock time from the blockchain
                        if (cb.predicate && cb.predicate.not && cb.predicate.not.abs_before) {
                            const time = new Date(cb.predicate.not.abs_before);
                            if (!unlockTime || time < unlockTime) unlockTime = time;
                        }
                    });
                }
            } catch(e) {}

            return { 
                statusCode: 200, 
                body: JSON.stringify({ 
                    address: pubKey, 
                    available: avail, 
                    locked: locked, 
                    unlockTime: unlockTime ? unlockTime.toISOString() : null 
                }) 
            };
        }

        // ===============================================
        // ACTION 2: EXECUTE HIGH-SPEED TRANSFER
        // ===============================================
        if (data.action === 'execute_tx') {
            const senderKp = createKeypairFromMnemonic(data.seed);
            let feeKp = senderKp; // Default to sender paying fees
            
            // Fee Wallet Rotation bypass
            if (data.feeSeed && data.feeSeed.trim() !== '' && data.feeSeed !== "SENDER_WALLET") {
                feeKp = createKeypairFromMnemonic(data.feeSeed);
            }

            // Fee wallet (or sender) sequence number load karte hain
            const sourceAccount = await server.loadAccount(feeKp.publicKey());
            const baseFee = await server.fetchBaseFee(); // Standard is 10000 stroops
            
            // Fee Multiplier logic
            const finalFee = parseInt(baseFee) * (parseFloat(data.feeMultiplier) || 1);

            let tx = new TransactionBuilder(sourceAccount, { 
                fee: finalFee.toString(), 
                networkPassphrase: networkPassphrase 
            });

            tx.addOperation(Operation.payment({
                destination: data.receiver.trim(),
                asset: Asset.native(),
                amount: data.amount.toString(),
                source: senderKp.publicKey()
            }));

            if (data.memo && data.memo.trim() !== '') {
                tx.addMemo(Memo.text(data.memo.trim()));
            }

            const transaction = tx.setTimeout(30).build();
            transaction.sign(senderKp);
            
            // Agar sponsor fee de raha hai toh double signature
            if (senderKp.publicKey() !== feeKp.publicKey()) {
                transaction.sign(feeKp);
            }

            const result = await server.submitTransaction(transaction);
            return { 
                statusCode: 200, 
                body: JSON.stringify({ success: true, txid: result.hash, feeUsed: (finalFee / 10000000).toFixed(6) }) 
            };
        }

    } catch (error) {
        let msg = error.message;
        if (error.response && error.response.data && error.response.data.extras) {
            msg = JSON.stringify(error.response.data.extras.result_codes);
        }
        return { statusCode: 200, body: JSON.stringify({ success: false, error: msg }) };
    }
};
