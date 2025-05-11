exports.handler = async (event) => {
  const { shopifyOrderId, mobimatterOrderId } = event.queryStringParameters;

  if (!shopifyOrderId || !mobimatterOrderId) {
    return {
      statusCode: 400,
      body: 'Missing order parameters.'
    };
  }

  try {
    // 1. Fetch Mobimatter order info
    const mmRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${mobimatterOrderId}`, {
      headers: { 'x-api-key': process.env.MOBIMATTER_API_KEY }
    });
    const mmData = await mmRes.json();

    const details = mmData?.result?.orderLineItem?.lineItemDetails || [];
    const qrItem = details.find(d => d.name === 'QR_CODE');
    const mobimatterId = mmData?.result?.orderId;

    if (!qrItem?.value || !mobimatterId) {
      return {
        statusCode: 200,
        body: 'No activation data found in Mobimatter response'
      };
    }

    // 2. Send to Shopify order metafields
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
        value: mobimatterId
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

    const result = await shopifyRes.json();

    if (result.errors) {
      return {
        statusCode: 500,
        body: `Shopify update failed: ${JSON.stringify(result)}`
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
