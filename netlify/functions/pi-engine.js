
const axios = require('axios');

exports.handler = async function(event, context) {
    // Only allow POST requests for security
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' })
        };
    }

    // Your Pi Server API Key stored in Netlify Environment Variables
    const API_KEY = process.env.PI_API_KEY; 
    
    if (!API_KEY) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server API Key is missing in environment variables.' })
        };
    }

    try {
        // Parse the request from your Frontend
        const data = JSON.parse(event.body);
        const { action, paymentId, txid } = data;

        const headers = { 
            headers: { Authorization: `Key ${API_KEY}` } 
        };

        // 🟢 ACTION 1: APPROVE PAYMENT
        if (action === 'approve') {
            if (!paymentId) throw new Error("Payment ID required for approval");
            
            const url = `https://api.minepi.com/v2/payments/${paymentId}/approve`;
            const response = await axios.post(url, null, headers);
            
            return {
                statusCode: 200,
                body: JSON.stringify({ status: 'approved', data: response.data })
            };
        } 
        
        // 🟢 ACTION 2: COMPLETE PAYMENT
        else if (action === 'complete') {
            if (!paymentId || !txid) throw new Error("Payment ID and TXID required for completion");
            
            const url = `https://api.minepi.com/v2/payments/${paymentId}/complete`;
            const payload = { txid: txid };
            const response = await axios.post(url, payload, headers);
            
            return {
                statusCode: 200,
                body: JSON.stringify({ status: 'completed', data: response.data })
            };
        } 
        
        else {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid action specified' }) };
        }

    } catch (error) {
        console.error("Backend Error:", error.response ? error.response.data : error.message);
        return {
            statusCode: error.response ? error.response.status : 500,
            body: JSON.stringify({ 
                error: 'Transaction Failed', 
                details: error.response ? error.response.data : error.message 
            })
        };
    }
};
