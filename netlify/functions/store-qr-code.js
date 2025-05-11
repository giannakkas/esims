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
    // 1. Get Mobimatter order info
    const response = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${mobimatterOrderId}`, {
      headers: {
        'Accept': 'text/plain',
        'merchantId': MOBIMATTER_MERCHANT_ID,
        'api-key': MOBIMATTER_API_KEY
      }
    });

    const data = await response.json();

    // 2. Get QR code from lineItemDetails
    const details = data?.result?.orderLineItem?.lineItemDetails;
    const qrItem = details?.find(d => d.name === 'QR_CODE');
    const qrBase64 = qrItem?.value;

    if (!qrBase64) {
      return {
        statusCode: 202,
        body: 'QR code not found in lineItemDetails yet'
      };
    }

    // 3. Save QR to Shopify order note
    const shopifyRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}.json`, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        order: {
          id: shopifyOrderId,
          note: `qr_code:${qrBase64}`
        }
      })
    });

    if (!shopifyRes.ok) {
      const error = await shopifyRes.text();
      throw new Error(`Shopify update failed: ${error}`);
    }

    return {
      statusCode: 200,
      body: 'QR code saved to Shopify order note successfully'
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: `Error: ${err.message}`
    };
  }
}
