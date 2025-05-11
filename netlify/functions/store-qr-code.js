const fetch = require('node-fetch');

exports.handler = async (event) => {
  // ✅ Replace this with your real Admin API token
  const SHOPIFY_ACCESS_TOKEN = 'your-shopify-access-token';
  const SHOPIFY_STORE_DOMAIN = 'esimszone.com';

  const { shopifyOrderId, mobimatterOrderId } = event.queryStringParameters;

  if (!shopifyOrderId || !mobimatterOrderId) {
    return {
      statusCode: 400,
      body: 'Missing shopifyOrderId or mobimatterOrderId'
    };
  }

  try {
    // Step 1: Get QR code from Mobimatter
    const mobimatterRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${mobimatterOrderId}`);
    const mobimatterData = await mobimatterRes.json();

    const qrUrl = mobimatterData?.activation?.imageUrl;

    if (!qrUrl) {
      return {
        statusCode: 202,
        body: 'QR code not ready yet'
      };
    }

    // Step 2: Save QR code in Shopify order note
    const shopifyRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/orders/${shopifyOrderId}.json`, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        order: {
          id: shopifyOrderId,
          note: `qr_code:${qrUrl}`
        }
      })
    });

    if (!shopifyRes.ok) {
      throw new Error('Failed to update Shopify order');
    }

    return {
      statusCode: 200,
      body: 'QR code saved to Shopify order note'
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: `Error: ${error.message}`
    };
  }
};
