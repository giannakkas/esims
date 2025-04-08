const axios = require('axios');

exports.handler = async (event, context) => {
  // Configure API constants
  const API_BASE = 'https://api.mobimatter.com/mobimatter/api/v2';
  const headers = {
    'Content-Type': 'application/json',
    'X-API-KEY': process.env.MOBIMATTER_API_KEY,
    'merchantId': process.env.MOBIMATTER_MERCHANT_ID
  };

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  try {
    // Handle GET requests (product listing)
    if (event.httpMethod === 'GET') {
      const response = await axios.get(`${API_BASE}/products`, { headers });
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(response.data)
      };
    }

    // Handle POST requests (order creation)
    if (event.httpMethod === 'POST') {
      const input = JSON.parse(event.body);
      
      // Validate input
      if (!input.planId || !input.customerEmail) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error: 'Missing planId or customerEmail'
          })
        };
      }

      // Create order
      const response = await axios.post(
        `${API_BASE}/order`, // Confirmed working endpoint
        {
          planId: input.planId,
          customerEmail: input.customerEmail
        },
        { headers }
      );

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(response.data)
      };
    }

    // Handle unsupported methods
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };

  } catch (error) {
    // Enhanced error logging
    console.error('API Error:', {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
      stack: error.stack
    });

    return {
      statusCode: error.response?.status || 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'API Request Failed',
        message: error.message,
        ...(error.response?.data && { details: error.response.data })
      })
    };
  }
};
