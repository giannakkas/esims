export async function handler(event) {
  const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_API_KEY;
  const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
  const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION;

  const MOBIMATTER_API_KEY = process.env.MOBIMATTER_API_KEY;
  const MOBIMATTER_MERCHANT_ID = process.env.MOBIMATTER_MERCHANT_ID;

  const { shopifyOrderId, mobimatterOrderId } = event.queryStringParameters;

  if (!shopifyOrderId || !mobimatterOrderId) {
    return {
      statusCode: 400,
      body: 'Missing shopifyOrderId or mobimatterOrderId'
    };
  }

  try {
    // ✅ Include Mobimatter headers
    const mobimatterRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${mobimatterOrderId}`, {
      headers: {
        'x-api-key': MOBIMATTER_API_KEY,
        'x-merchant-id': MOBIMATTER_MERCHANT_ID
      }
    });

    const mobimatterData = await mobimatterRes.json();

    // 🔍 TEMP: Show full Mobimatter response (for debugging)
    return {
      statusCode: 200,
      body: JSON.stringify(mobimatterData, null, 2)
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: `Error: ${error.message}`
    };
  }
}
