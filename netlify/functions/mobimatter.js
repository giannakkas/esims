const axios = require('axios');

exports.handler = async (event, context) => {
  // ======================
  // 1. Configure Response Headers
  // ======================
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // ======================
  // 2. Debugging: Log Incoming Event
  // ======================
  console.log('Received event:', JSON.stringify({
    method: event.httpMethod,
    path: event.path,
    body: event.body,
    query: event.queryStringParameters
  }, null, 2));

  // ======================
  // 3. Validate HTTP Method
  // ======================
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ 
        error: 'Method Not Allowed', 
        message: 'Only POST requests are accepted' 
      })
    };
  }

  // ======================
  // 4. Parse and Validate Input
  // ======================
  let input;
  try {
    input = JSON.parse(event.body || '{}');
    
    // Auto-detect Shopify webhook format
    if (input.email && input.line_items) {
      input = {
        planId: input.line_items[0]?.sku || `shopify_${input.line_items[0]?.variant_id}`,
        customerEmail: input.email,
        orderId: input.id,
        isShopify: true
      };
    }

    // Validate required fields
    if (!input.planId || !input.customerEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Missing required fields',
          required: { 
            planId: 'eSIM plan ID (e.g., "global_10gb")', 
            customerEmail: 'user@example.com' 
          },
          received: input
        })
      };
    }
  } catch (err) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Invalid JSON format',
        details: err.message,
        example: {
          planId: "test_plan",
          customerEmail: "user@example.com",
          orderId: "optional_shopify_order_id"
        }
      })
    };
  }

  // ======================
  // 5. Call MobiMatter API
  // ======================
  try {
    console.log('Calling MobiMatter API with:', JSON.stringify({
      planId: input.planId,
      email: input.customerEmail
    }));

    const response = await axios.post(
      'https://api.mobimatter.com/v2/order',
      {
        merchantId: process.env.MOBIMATTER_MERCHANT_ID,
        planId: input.planId,
        customerEmail: input.customerEmail
      },
      {
        headers: {
          'X-API-Key': process.env.MOBIMATTER_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 8000 // 8-second timeout
      }
    );

    console.log('MobiMatter response:', JSON.stringify(response.data));

    // ======================
    // 6. Update Shopify Order (if applicable)
    // ======================
    if (input.orderId && process.env.SHOPIFY_ADMIN_API_KEY) {
      try {
        await axios.post(
          `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION}/orders/${input.orderId}/notes.json`,
          {
            note: `eSIM Activated: ${response.data.activationLink || 'Check email for details'}`
          },
          {
            headers: {
              'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_KEY
            }
          }
        );
      } catch (shopifyError) {
        console.error('Shopify note update failed (non-critical):', shopifyError.message);
      }
    }

    // ======================
    // 7. Return Success
    // ======================
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        activationLink: response.data.activationLink,
        qrCode: response.data.qrCodeUrl,
        orderId: input.orderId || null
      })
    };

  } catch (error) {
    // Detailed error logging
    console.error('API Error:', {
      message: error.message,
      response: error.response?.data,
      stack: error.stack
    });

    return {
      statusCode: error.response?.status || 500,
      headers,
      body: JSON.stringify({
        error: 'eSIM activation failed',
        details: error.response?.data || error.message,
        requestData: input
      })
    };
  }
};
