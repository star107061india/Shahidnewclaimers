const { Keypair, Horizon } = require('stellar-sdk');
const { mnemonicToSeedSync } = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');

const server = new Horizon.Server("https://api.mainnet.minepi.com", {
    httpClient: axios.create({ timeout: 15000 }) // Fast timeout
});

const createKeypairFromMnemonic = (mnemonic) => {
    try {
        return Keypair.fromRawEd25519Seed(derivePath("m/44'/314159'/0'", mnemonicToSeedSync(mnemonic).toString('hex')).key);
    } catch (e) {
        throw new Error("Invalid keyphrase. Please check for typos or extra spaces.");
    }
};

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const { mnemonic } = JSON.parse(event.body);
        if (!mnemonic) return { statusCode: 400, body: JSON.stringify({ success: false, error: "Keyphrase is required." }) };

        const keypair = createKeypairFromMnemonic(mnemonic);
        const response = await server.claimableBalances().claimant(keypair.publicKey()).limit(100).call();
        
        const balances = response.records.map(r => ({ id: r.id, amount: r.amount, asset: "PI" }));

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, balances, publicKey: keypair.publicKey() })
        };
    } catch (error) {
        console.error("Error fetching balances:", error);
        return {
            statusCode: 200,
            body: JSON.stringify({ success: false, error: error.message || "Network Error" })
        };
    }
};
