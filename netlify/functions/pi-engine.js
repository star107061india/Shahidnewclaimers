const { Keypair, Horizon, TransactionBuilder, Operation, Asset, Memo } = require('stellar-sdk');
const { mnemonicToSeedSync } = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');

const createKeypair = (secret) => {
    try {
        if (secret.startsWith('S') && secret.length === 56) return Keypair.fromSecret(secret);
        const seed = mnemonicToSeedSync(secret.trim());
        return Keypair.fromRawEd25519Seed(derivePath("m/44'/314159'/0'", seed.toString('hex')).key);
    } catch (e) { throw new Error("Invalid Passphrase"); }
};

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const data = JSON.parse(event.body);
        const server = new Horizon.Server('https://api.mainnet.minepi.com', { 
            httpClient: axios.create({ timeout: 15000 }) 
        });

        // 1. AUTO FETCH BALANCES & UNLOCK TIME
        if (data.action === 'sync') {
            const kp = createKeypair(data.seed);
            const pubKey = kp.publicKey();
            let balances = [];

            try {
                const claimables = await server.claimableBalances().claimant(pubKey).limit(20).call();
                if (claimables.records && claimables.records.length > 0) {
                    balances = claimables.records.map(cb => {
                        let unlockTime = null;
                        if (cb.predicate && cb.predicate.not && cb.predicate.not.abs_before) {
                            unlockTime = cb.predicate.not.abs_before;
                        }
                        return { id: cb.id, amount: cb.amount, unlockTime };
                    });
                }
            } catch(e) {}

            return { statusCode: 200, body: JSON.stringify({ address: pubKey, balances }) };
        }

        // 2. FEE MANAGER: MULTI-SPONSOR FETCH
        if (data.action === 'sync_sponsors') {
            let results = [];
            for (let seed of data.seeds) {
                try {
                    const kp = createKeypair(seed);
                    const account = await server.loadAccount(kp.publicKey());
                    let avail = "0.00";
                    account.balances.forEach(b => { if (b.asset_type === 'native') avail = b.balance; });
                    results.push({ address: kp.publicKey(), balance: avail, status: 'Active' });
                } catch(e) {
                    results.push({ address: 'Invalid/Unfunded', balance: '0.00', status: 'Failed' });
                }
            }
            return { statusCode: 200, body: JSON.stringify({ sponsors: results }) };
        }

        // 3. EXECUTE: ATOMIC CLAIM + TRANSFER WITH CUSTOM EXACT FEE
        if (data.action === 'execute') {
            const senderKp = createKeypair(data.seed);
            let feeKp = senderKp;
            
            if (data.feePayer === 'custom' && data.sponsorSeed) {
                feeKp = createKeypair(data.sponsorSeed);
            }

            const sourceAccount = await server.loadAccount(feeKp.publicKey());
            
            // EXACT FEE LOGIC: UI Input (e.g., 0.01 Pi) converted exactly to stroops (1 Pi = 10,000,000 stroops)
            const feeStroops = Math.floor(parseFloat(data.feePi) * 10000000).toString();

            let tx = new TransactionBuilder(sourceAccount, { 
                fee: feeStroops, 
                networkPassphrase: 'Pi Network' 
            });

            if (data.claimableId) {
                tx.addOperation(Operation.claimClaimableBalance({ balanceId: data.claimableId, source: senderKp.publicKey() }));
            }

            tx.addOperation(Operation.payment({
                destination: data.receiver.trim(),
                asset: Asset.native(),
                amount: data.amountToSend.toString(),
                source: senderKp.publicKey()
            }));

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
