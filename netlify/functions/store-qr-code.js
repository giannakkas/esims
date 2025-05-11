export async function handler(event) {
  const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_API_KEY;
  const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
  const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION;

  const MOBIMATTER_API_KEY = process.env.MOBIMATTER_API_KEY;
  const MOBIMATTER_MERCHANT_ID = process.env.MOBIMATTER_MERCHANT_ID;

  const { shopifyOrderId, mobimatterOrderId: queryMobimatterId } = event.queryStringParameters;

  if (!shopifyOrderId) {
    return { statusCode: 400, body: 'Missing shopifyOrderId' };
  }

  try {
    let mobimatterOrderId = queryMobimatterId;

    if (!mobimatterOrderId) {
      // Try to fetch it from Shopify metafield
      const metafieldRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: `
            query {
              order(id: "gid://shopify/Order/${shopifyOrderId}") {
                metafield(namespace: "esim", key: "mobimatter_order_id") {
                  value
                }
              }
            }
          `
        })
      });

      const metafieldData = await metafieldRes.json();
      mobimatterOrderId = metafieldData?.data?.order?.metafield?.value;

      if (!mobimatterOrderId) {
        return {
          statusCode: 404,
          body: 'Mobimatter order ID not found in Shopify metafield'
        };
      }
    }

    // Fetch Mobimatter order
    const response = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${mobimatterOrderId}`, {
      headers: {
        'Accept': 'text/plain',
        'merchantId': MOBIMATTER_MERCHANT_ID,
        'api-key': MOBIMATTER_API_KEY
      }
    });

    const data = await response.json();
    const details = data?.result?.orderLineItem?.lineItemDetails;
    const qrItem = details?.find(d => d.name === 'QR_CODE');
    const qrBase64 = qrItem?.value;

    if (!qrBase64) {
      return {
        statusCode: 202,
        body: 'QR code not found in lineItemDetails yet'
      };
    }

    // Save QR code to Shopify order metafield
    const gqlRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: `
          mutation {
            orderUpdate(input: {
              id: "gid://shopify/Order/${shopifyOrderId}",
              metafields: [{
                namespace: "esim",
                key: "qr_code",
                type: "multi_line_text_field",
                value: "${qrBase64}"
              }]
            }) {
              order { id }
              userErrors { field message }
            }
          }
        `
      })
    });

    const result = await gqlRes.json();

    if (result?.data?.orderUpdate?.userErrors?.length) {
      return {
        statusCode: 500,
        body: `Shopify GraphQL error: ${JSON.stringify(result.data.orderUpdate.userErrors)}`
      };
    }

    return {
      statusCode: 200,
      body: 'QR code saved to Shopify order metafield'
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: `Error: ${err.message}`
    };
  }
}
