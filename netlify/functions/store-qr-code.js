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
    // 🔍 Step 1: Log full Mobimatter response
    const mobimatterRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${mobimatterOrderId}`);
    const mobimatterData = await mobimatterRes.json();

    // TEMP: Return full JSON so we can inspect it
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
