const { Keypair, Horizon, Operation, TransactionBuilder, Asset } = require('stellar-sdk');
const { mnemonicToSeedSync } = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');

const server = new Horizon.Server("https://api.mainnet.minepi.com", {
    httpClient: axios.create({ timeout: 15000 })
});

const createKeypairFromMnemonic = (mnemonic) => {
    try {
        return Keypair.fromRawEd25519Seed(derivePath("m/44'/314159'/0'", mnemonicToSeedSync(mnemonic.trim()).toString('hex')).key);
    } catch (e) {
        throw new Error("Invalid keyphrase.");
    }
};

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const params = JSON.parse(event.body);
        const senderKeypair = createKeypairFromMnemonic(params.senderMnemonic);
        
        let sponsorKeypair = null;
        if (params.feeType === 'SPONSOR_PAYS') {
            // Multi-wallet sponsor logic for bypass sequence bottlenecks
            if (params.sponsorWallets && params.sponsorWallets.length > 0) {
                const randomSponsor = params.sponsorWallets[Math.floor(Math.random() * params.sponsorWallets.length)];
                sponsorKeypair = createKeypairFromMnemonic(randomSponsor);
            } else if (params.sponsorMnemonic) {
                sponsorKeypair = createKeypairFromMnemonic(params.sponsorMnemonic);
            } else {
                throw new Error("Sponsor phrase missing.");
            }
        }

        const sourceAccountKeypair = (params.feeType === 'SPONSOR_PAYS') ? sponsorKeypair : senderKeypair;
        const accountToLoad = await server.loadAccount(sourceAccountKeypair.publicKey());
        
        // Fee Calculation Logic (World's fastest priority)
        let baseFee = await server.fetchBaseFee(); // Usually 10000 stroops
        let feeToUse = parseInt(baseFee);

        if (params.feeMechanism === 'CUSTOM' && params.customFee) {
            feeToUse = parseInt(params.customFee);
        } else if (params.feeMechanism === 'SPEED_2X') {
            feeToUse = feeToUse * 2;
        } else if (params.feeMechanism === 'SPEED_3X') {
            feeToUse = feeToUse * 3;
        } else if (params.feeMechanism === 'SPEED_4X') {
            feeToUse = feeToUse * 4;
        } else if (params.feeMechanism === 'SPEED_HIGH') {
            feeToUse = feeToUse * 10;
        }
        
        const tx = new TransactionBuilder(accountToLoad, {
            fee: feeToUse.toString(),
            networkPassphrase: "Pi Network",
        });

        // Add operations based on type
        if (params.operation === 'claim_and_transfer') {
            tx.addOperation(Operation.claimClaimableBalance({
                balanceId: params.claimableId,
                source: senderKeypair.publicKey()
            }));
        }
        
        tx.addOperation(Operation.payment({
            destination: params.receiverAddress,
            asset: Asset.native(),
            amount: params.amount.toString(),
            source: senderKeypair.publicKey()
        }));

        const transaction = tx.setTimeout(30).build();
        
        // Signatures
        transaction.sign(senderKeypair);
        if (params.feeType === 'SPONSOR_PAYS') {
            transaction.sign(sponsorKeypair);
        }
        
        // Submit
        const result = await server.submitTransaction(transaction);

        if (result && result.hash) {
             return { statusCode: 200, body: JSON.stringify({ success: true, response: result }) };
        } else {
            throw new Error("Submitted but no hash returned.");
        }

    } catch (error) {
        console.error("TX Error:", error);
        let detailedError = error.message;
        
        if (error.response && error.response.data && error.response.data.extras) {
            detailedError = "Blockchain Error: " + JSON.stringify(error.response.data.extras.result_codes);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ success: false, error: detailedError })
        };
    }
};
