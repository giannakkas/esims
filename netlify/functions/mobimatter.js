const axios = require('axios');

exports.handler = async (event, context) => {
  // ======================
  // 1. Handle CORS Preflight
  // ======================
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
      },
      body: ''
    };
  }

  // ======================
  // 2. Parse Input
  // ======================
  let input;
  try {
    // Handle both direct calls and Shopify webhooks
    input = event.body ? JSON.parse(event.body) : {};
    
    // Shopify webhook format
    if (input.line_items) {
      input = {
        planId: input.line_items[0]?.sku || 'default_plan',
        customerEmail: input.email,
        orderId: input.id
      };
    }
  } catch (err) {
    return respond(400, { error: "Invalid JSON body", details: err.message });
  }

  // ======================
  // 3. Validate Required Fields
  // ======================
  if (!input.planId || !input.customerEmail) {
    return respond(400, { 
      error: "Missing required fields",
      required: ["planId", "customerEmail"],
      received: input
    });
  }

  // ======================
  // 4. Call MobiMatter API
  // ======================
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
        }
      }
    );

    // ======================
    // 5. Optional: Update Shopify Order
    // ======================
    if (input.orderId && process.env.SHOPIFY_ADMIN_API_KEY) {
      await axios.post(
        `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION}/orders/${input.orderId}/notes.json`,
        {
          note: `eSIM Activated: ${mobimatterResponse.data.activationLink}`
        },
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_KEY
          }
        }
      );
    }

    // ======================
    // 6. Return Success
    // ======================
    return respond(200, {
      success: true,
      activationLink: mobimatterResponse.data.activationLink,
      qrCode: mobimatterResponse.data.qrCodeUrl
    });

  } catch (err) {
    return respond(500, {
      error: "MobiMatter API Error",
      details: err.response?.data || err.message,
      requestData: input
    });
  }
};

// Helper function for consistent responses
function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  };
}
