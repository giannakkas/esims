const axios = require('axios');

exports.handler = async (event, context) => {
  // Configure API constants
  const API_BASE_URL = 'https://api.mobimatter.com/mobimatter/api/v2/public';
  const headers = {
    'Content-Type': 'application/json',
    'X-API-KEY': process.env.MOBIMATTER_API_KEY,
    'merchantId': process.env.MOBIMATTER_MERCHANT_ID
  };

  // Set up CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    // =====================================
    // 1. Handle GET Requests (Product Listing)
    // =====================================
    if (event.httpMethod === 'GET') {
      const response = await axios.get(`${API_BASE_URL}/products`, { headers });
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          products: response.data
        })
      };
    }

    // =====================================
    // 2. Handle POST Requests (Order Creation)
    // =====================================
    if (event.httpMethod === 'POST') {
      // Parse and validate input
      const input = JSON.parse(event.body || '{}');
      
      if (!input.planId || !input.customerEmail) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error: 'Missing required fields',
            required: ['planId', 'customerEmail'],
            received: input
          })
        };
      }

      // Create order payload
      const orderPayload = {
        planId: input.planId,
        customerEmail: input.customerEmail,
        // Add additional optional fields
        ...(input.orderId && { externalReference: input.orderId }),
        ...(input.countryCode && { countryCode: input.countryCode })
      };

      // Call MobiMatter API
      const response = await axios.post(
        `${API_BASE_URL}/order`,
        orderPayload,
        { headers }
      );

      // Optional: Update Shopify order if orderId exists
      if (input.orderId && process.env.SHOPIFY_ADMIN_API_KEY) {
        try {
          await axios.post(
            `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION}/orders/${input.orderId}/notes.json`,
            {
              note: `eSIM Activated: ${response.data.activationLink || response.data.orderId}`
            },
            {
              headers: {
                'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_KEY,
                'Content-Type': 'application/json'
              }
            }
          );
        } catch (shopifyError) {
          console.error('Non-critical Shopify update error:', shopifyError.message);
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          order: response.data
        })
      };
    }

    // Handle unsupported methods
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Method Not Allowed',
        allowedMethods: ['GET', 'POST']
      })
    };

  } catch (error) {
    // Detailed error logging
    console.error('API Error:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
      request: error.config?.data
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
