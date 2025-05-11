const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  const { shopifyOrderId, mobimatterOrderId } = event.queryStringParameters;

  if (!shopifyOrderId || !mobimatterOrderId) {
    return {
      statusCode: 400,
      body: 'Missing order ID',
    };
  }

  const MOBIMATTER_API_KEY = process.env.MOBIMATTER_API_KEY;
  const MOBIMATTER_MERCHANT_ID = process.env.MOBIMATTER_MERCHANT_ID;
  const SHOPIFY_ADMIN_API_KEY = process.env.SHOPIFY_ADMIN_API_KEY;
  const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
  const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION;

  try {
    // Step 1: Fetch Mobimatter activation
    const mmResponse = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${mobimatterOrderId}`, {
      headers: {
        'x-api-key': MOBIMATTER_API_KEY,
        'x-merchant-id': MOBIMATTER_MERCHANT_ID,
      },
    });

    const mmData = await mmResponse.json();

    const qrUrl = mmData?.activation?.imageUrl;
    if (!qrUrl) {
      return {
        statusCode: 404,
        body: 'No activation data found in Mobimatter response',
      };
    }

    // Step 2: Update Shopify order metafields
    const response = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}/metafields.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_KEY,
      },
      body: JSON.stringify({
        metafield: {
          namespace: 'esim',
          key: 'qr_code',
          type: 'single_line_text_field',
          value: qrUrl,
        },
      }),
    });

    await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}/metafields.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_KEY,
      },
      body: JSON.stringify({
        metafield: {
          namespace: 'esim',
          key: 'mobimatter_order_id',
          type: 'single_line_text_field',
          value: mobimatterOrderId,
        },
      }),
    });

    return {
      statusCode: 200,
      body: 'QR code and order ID saved to Shopify metafields',
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: `Server error: ${err.message}`,
    };
  }
};
