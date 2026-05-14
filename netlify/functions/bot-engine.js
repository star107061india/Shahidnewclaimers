const StellarSdk = require('stellar-sdk');

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Use POST method' };
    }

    try {
        const data = JSON.parse(event.body);
        
        // Connect to Real Pi Mainnet
        const server = new StellarSdk.Server('https://api.mainnet.minepi.com');
        const networkPassphrase = 'Pi Network';

        // ==========================================
        // ACTION 1: FETCH REAL WALLET DATA
        // ==========================================
        if (data.action === 'wallet_info') {
            // Note: Stellar SDK requires the Secret Key (starts with 'S')
            const keypair = StellarSdk.Keypair.fromSecret(data.seed.trim());
            const publicKey = keypair.publicKey();
            
            try {
                const account = await server.loadAccount(publicKey);
                let available = "0.00";
                
                // Get Native Pi Balance
                account.balances.forEach(b => {
                    if (b.asset_type === 'native') available = b.balance;
                });

                // Fetch Claimable/Locked Balances
                let locked = "0.00";
                let unlockTime = "Unlocked";
                const claimables = await server.claimableBalances().claimant(publicKey).call();
                
                if (claimables.records && claimables.records.length > 0) {
                    claimables.records.forEach(cb => {
                        locked = (parseFloat(locked) + parseFloat(cb.amount)).toFixed(7);
                        if (cb.sponsors && cb.sponsors.length > 0) {
                            unlockTime = "Locked (Check Explorer)";
                        }
                    });
                }

                return {
                    statusCode: 200,
                    body: JSON.stringify({
                        address: publicKey,
                        available: available,
                        locked: locked,
                        unlockTime: unlockTime
                    })
                };
            } catch (e) {
                return {
                    statusCode: 200,
                    body: JSON.stringify({
                        address: publicKey,
                        available: "0.00",
                        locked: "0.00",
                        unlockTime: "Unfunded/New Wallet",
                        error: "Account not found on blockchain"
                    })
                };
            }
        }

        // ==========================================
        // ACTION 2: EXECUTE REAL TRANSACTION
        // ==========================================
        if (data.action === 'execute_tx') {
            const keypair = StellarSdk.Keypair.fromSecret(data.seed.trim());
            const sourceAccount = await server.loadAccount(keypair.publicKey());
            
            let builder = new StellarSdk.TransactionBuilder(sourceAccount, {
                fee: "10000", // Standard 0.01 Pi fee
                networkPassphrase: networkPassphrase
            });

            builder.addOperation(StellarSdk.Operation.payment({
                destination: data.receiver.trim(),
                asset: StellarSdk.Asset.native(),
                amount: data.amount.toString()
            }));

            if (data.memo) {
                builder.addMemo(StellarSdk.Memo.text(data.memo));
            }

            const tx = builder.setTimeout(30).build();
            tx.sign(keypair);
            
            const response = await server.submitTransaction(tx);

            return {
                statusCode: 200,
                body: JSON.stringify({ txid: response.hash, status: 'success' })
            };
        }

        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid action' }) };

    } catch (error) {
        let errMsg = error.message;
        if (error.response && error.response.data) {
            errMsg = JSON.stringify(error.response.data.extras || error.response.data);
        }
        return {
            statusCode: 500,
            body: JSON.stringify({ error: errMsg })
        };
    }
};
