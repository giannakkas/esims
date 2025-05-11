export async function handler(event) {
  const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_API_KEY;
  const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
  const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION;

  const { shopifyOrderId, mobimatterOrderId } = event.queryStringParameters;

  if (!shopifyOrderId || !mobimatterOrderId) {
    return {
      statusCode: 400,
      body: 'Missing shopifyOrderId or mobimatterOrderId'
    };
  }

  try {
    // 1. Fetch Mobimatter order info
    const mobimatterRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${mobimatterOrderId}`);
    const mobimatterData = await mobimatterRes.json();

    const qrUrl = mobimatterData?.activation?.imageUrl;

    if (!qrUrl) {
      return {
        statusCode: 202,
        body: 'QR code not ready yet'
      };
    }

    // 2. Update order note in Shopify
    const shopifyRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}.json`, {
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
      const text = await shopifyRes.text();
      throw new Error(`Shopify error: ${text}`);
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
}
