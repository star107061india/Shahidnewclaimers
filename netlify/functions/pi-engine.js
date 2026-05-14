const axios = require('axios');

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // Netlify Environment Variable se API KEY uthao
    const API_KEY = process.env.PI_API_KEY; 
    
    if (!API_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Server API Key is missing in Netlify settings.' }) };
    }

    try {
        const data = JSON.parse(event.body);
        const { action, paymentId, txid } = data;

        const headers = { 
            headers: { Authorization: `Key ${API_KEY}` } 
        };

        // ==========================================
        // ACTION 1: APPROVE PAYMENT (Pi Docs)
        // ==========================================
        if (action === 'approve') {
            if (!paymentId) throw new Error("Payment ID required");
            const url = `https://api.minepi.com/v2/payments/${paymentId}/approve`;
            const response = await axios.post(url, null, headers);
            
            return {
                statusCode: 200,
                body: JSON.stringify({ status: 'approved', data: response.data })
            };
        } 
        
        // ==========================================
        // ACTION 2: COMPLETE PAYMENT (Pi Docs)
        // ==========================================
        else if (action === 'complete') {
            if (!paymentId || !txid) throw new Error("Payment ID and TXID required");
            const url = `https://api.minepi.com/v2/payments/${paymentId}/complete`;
            const payload = { txid: txid };
            const response = await axios.post(url, payload, headers);
            
            return {
                statusCode: 200,
                body: JSON.stringify({ status: 'completed', data: response.data })
            };
        } 
        else {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid action' }) };
        }

    } catch (error) {
        return {
            statusCode: error.response ? error.response.status : 500,
            body: JSON.stringify({ 
                error: 'Backend API Failed', 
                details: error.response ? error.response.data : error.message 
            })
        };
    }
};
