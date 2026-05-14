const { Keypair, Horizon, TransactionBuilder, Operation, Asset, Memo } = require('stellar-sdk');
const { mnemonicToSeedSync } = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');

const createKeypair = (secret) => {
    try {
        if (secret.startsWith('S') && secret.length === 56) return Keypair.fromSecret(secret);
        const seed = mnemonicToSeedSync(secret.trim());
        return Keypair.fromRawEd25519Seed(derivePath("m/44'/314159'/0'", seed.toString('hex')).key);
    } catch (e) {
        throw new Error("Invalid Passphrase or Secret Key.");
    }
};

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const data = JSON.parse(event.body);
        const serverUrl = data.network === 'testnet' ? 'https://api.testnet.minepi.com' : 'https://api.mainnet.minepi.com';
        const networkPassphrase = data.network === 'testnet' ? 'Pi Testnet' : 'Pi Network';
        
        // Fast HTTP Client for minimum latency
        const server = new Horizon.Server(serverUrl, { httpClient: axios.create({ timeout: 10000 }) });

        // ===============================================
        // ACTION 1: AUTO FETCH (Balances & Exact Unlock Time)
        // ===============================================
        if (data.action === 'fetch_data') {
            const kp = createKeypair(data.seed);
            const pubKey = kp.publicKey();
            let avail = "0.00", locked = "0.00", claimableId = null, exactUnlockTime = null;

            try {
                const account = await server.loadAccount(pubKey);
                account.balances.forEach(b => { if (b.asset_type === 'native') avail = b.balance; });
            } catch(e) {} 

            try {
                const claimables = await server.claimableBalances().claimant(pubKey).limit(10).call();
                if (claimables.records && claimables.records.length > 0) {
                    const cb = claimables.records[0]; // Get primary locked balance
                    locked = cb.amount;
                    claimableId = cb.id;
                    if (cb.predicate && cb.predicate.not && cb.predicate.not.abs_before) {
                        exactUnlockTime = cb.predicate.not.abs_before; // Exact UTC time from blockchain
                    }
                }
            } catch(e) {}

            return { 
                statusCode: 200, 
                body: JSON.stringify({ address: pubKey, available: avail, locked: locked, claimableId, exactUnlockTime }) 
            };
        }

        // ===============================================
        // ACTION 2: COMBINED CLAIM & SEND (High Priority)
        // ===============================================
        if (data.action === 'execute_tx') {
            const senderKp = createKeypair(data.seed);
            let feeKp = senderKp;
            
            // Fee Payer logic
            if (data.feeSeed && data.feeSeed.trim() !== '') {
                feeKp = createKeypair(data.feeSeed);
            }

            const sourceAccount = await server.loadAccount(feeKp.publicKey());
            const baseFee = await server.fetchBaseFee(); 
            const finalFee = parseInt(baseFee) * (parseFloat(data.feeMultiplier) || 1);

            let tx = new TransactionBuilder(sourceAccount, { 
                fee: finalFee.toString(), 
                networkPassphrase: networkPassphrase 
            });

            // ⭐ CRITICAL: The "Claimable, Send" Logic in ONE transaction
            if (data.isClaimable && data.claimableId) {
                tx.addOperation(Operation.claimClaimableBalance({
                    balanceId: data.claimableId,
                    source: senderKp.publicKey()
                }));
            }

            tx.addOperation(Operation.payment({
                destination: data.receiver.trim(),
                asset: Asset.native(),
                amount: data.amount.toString(),
                source: senderKp.publicKey()
            }));

            if (data.memo) tx.addMemo(Memo.text(data.memo.trim()));

            const transaction = tx.setTimeout(30).build();
            transaction.sign(senderKp);
            if (senderKp.publicKey() !== feeKp.publicKey()) transaction.sign(feeKp);

            const result = await server.submitTransaction(transaction);
            return { statusCode: 200, body: JSON.stringify({ success: true, txid: result.hash }) };
        }

    } catch (error) {
        let msg = error.message;
        if (error.response && error.response.data && error.response.data.extras) {
            msg = JSON.stringify(error.response.data.extras.result_codes);
        }
        return { statusCode: 200, body: JSON.stringify({ success: false, error: msg }) };
    }
};
