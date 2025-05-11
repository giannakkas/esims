const fetch = require('node-fetch');

exports.handler = async (event) => {
  const { shopifyOrderId, mobimatterOrderId } = event.queryStringParameters;

  if (!shopifyOrderId || !mobimatterOrderId) {
    return {
      statusCode: 400,
      body: 'Missing order parameters.'
    };
  }

  try {
    // Step 1: Get Mobimatter Order Info
    const mmResponse = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${mobimatterOrderId}`, {
      headers: { 'x-api-key': process.env.MOBIMATTER_API_KEY }
    });
    const mmData = await mmResponse.json();

    if (!mmData?.result?.orderLineItem?.lineItemDetails) {
      return {
        statusCode: 200,
        body: 'No activation data found in Mobimatter response'
      };
    }

    const qrItem = mmData.result.orderLineItem.lineItemDetails.find(d => d.name === 'QR_CODE');
    const mobimatterOrderIdItem = mmData.result.orderId;

    if (!qrItem || !qrItem.value) {
      return {
        statusCode: 200,
        body: 'No QR code found'
      };
    }

    // Step 2: Save QR and Order ID to Shopify Order Metafields
    const metafields = [
      {
        namespace: "esim",
        key: "qr_code",
        type: "single_line_text_field",
        value: qrItem.value
      },
      {
        namespace: "esim",
        key: "mobimatter_order_id",
        type: "single_line_text_field",
        value: mobimatterOrderIdItem
      }
    ];

    const shopifyRes = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION}/orders/${shopifyOrderId}/metafields.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_KEY
      },
      body: JSON.stringify({ metafields })
    });

    const shopifyData = await shopifyRes.json();

    if (shopifyData.errors) {
      return {
        statusCode: 500,
        body: `Shopify update failed: ${JSON.stringify(shopifyData)}`
      };
    }

    return {
      statusCode: 200,
      body: 'QR code saved to Shopify order metafield'
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: `Server error: ${err.message}`
    };
  }
};
