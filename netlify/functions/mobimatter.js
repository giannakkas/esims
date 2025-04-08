const axios = require('axios');

exports.handler = async (event, context) => {
  // =====================================
  // 1. CORS Handling (for browser requests)
  // =====================================
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: ''
    };
  }

  // =====================================
  // 2. Request Validation
  // =====================================
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

  // =====================================
  // 3. Parse and Validate Input
  // =====================================
  let input;
  try {
    input = event.body ? JSON.parse(event.body) : null;
    
    if (!input) {
      throw new Error('Empty request body');
    }

    // Shopify webhook format conversion
    if (input.line_items) {
      input = {
        planId: input.line_items[0]?.sku || input.line_items[0]?.variant_id,
        customerEmail: input.email,
        orderId: input.id,
        isShopifyWebhook: true
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
            planId: 'eSIM plan identifier (SKU or variant ID)',
            customerEmail: 'Customer email address'
          },
          received: input
        })
      };
    }

  } catch (error) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Invalid request format',
        message: error.message,
        example: {
          planId: 'prepaid_esim_10gb',
          customerEmail: 'customer@example.com',
          orderId: 'optional_shopify_order_id'
        }
      })
    };
  }

  // =====================================
  // 4. MobiMatter API Integration
  // =====================================
  try {
    const mobimatterResponse = await axios.post(
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
        timeout: 5000 // 5 second timeout
      }
    );

    // =====================================
    // 5. Shopify Order Update (if orderId exists)
    // =====================================
    if (input.orderId && process.env.SHOPIFY_ADMIN_API_KEY) {
      try {
        await axios.post(
          `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION}/orders/${input.orderId}/notes.json`,
          {
            note: `eSIM Activated: ${mobimatterResponse.data.activationLink || 'See attached email'}`
          },
          {
            headers: {
              'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_KEY,
              'Content-Type': 'application/json'
            }
          }
        );
      } catch (shopifyError) {
        console.error('Shopify update failed:', shopifyError.message);
      }
    }

    // =====================================
    // 6. Success Response
    // =====================================
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        activationLink: mobimatterResponse.data.activationLink,
        qrCode: mobimatterResponse.data.qrCodeUrl,
        orderId: input.orderId || null
      })
    };

  } catch (apiError) {
    // Detailed error logging
    console.error('API Error:', {
      message: apiError.message,
      response: apiError.response?.data,
      request: {
        planId: input.planId,
        email: input.customerEmail
      }
    });

    return {
      statusCode: apiError.response?.status || 500,
      headers,
      body: JSON.stringify({
        error: 'eSIM activation failed',
        details: apiError.response?.data || apiError.message,
        requestId: context.awsRequestId
      })
    };
  }
};
