const axios = require('axios');

exports.handler = async (event, context) => {
  const { planId, orderId, customerEmail } = JSON.parse(event.body);

  try {
    // Step 1: Purchase eSIM from MobiMatter
    const mobimatterResponse = await axios.post(
      'https://api.mobimatter.com/v2/order',
      {
        merchantId: process.env.MOBIMATTER_MERCHANT_ID,
        planId,
        customerEmail,
      },
      {
        headers: {
          'X-API-Key': process.env.MOBIMATTER_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    // Step 2: Attach eSIM to Shopify Order
    await axios.post(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION}/orders/${orderId}/notes.json`,
      {
        note: `eSIM Activation Link: ${mobimatterResponse.data.activationLink}`,
      },
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_KEY,
        },
      }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        activationLink: mobimatterResponse.data.activationLink,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.response?.data || error.message,
      }),
    };
  }
};
