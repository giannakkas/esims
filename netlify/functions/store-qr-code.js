
const axios = require('axios');
const fetch = require('node-fetch');

exports.handler = async (event) => {
  const { shopifyOrderId, mobimatterOrderId } = event.queryStringParameters;

  if (!shopifyOrderId || !mobimatterOrderId) {
    return {
      statusCode: 400,
      body: 'Missing Shopify or Mobimatter Order ID',
    };
  }

  // Mobimatter credentials
  const MOBIMATTER_API_KEY = process.env.MOBIMATTER_API_KEY;
  const MOBIMATTER_MERCHANT_ID = process.env.MOBIMATTER_MERCHANT_ID;

  try {
    const mobiResponse = await axios.get(
      `https://api.mobimatter.com/mobimatter/api/v2/order/${mobimatterOrderId}`,
      {
        headers: {
          'api-key': MOBIMATTER_API_KEY,
          'merchantId': MOBIMATTER_MERCHANT_ID,
          'Accept': 'text/plain',
        },
      }
    );

    const activationInfo = mobiResponse?.data?.result?.orderLineItem?.lineItemDetails || [];
    const qrEntry = activationInfo.find((item) => item.name === 'QR_CODE');

    if (!qrEntry || !qrEntry.value) {
      return {
        statusCode: 200,
        body: 'No activation data found in Mobimatter response',
      };
    }

    // Save QR Code + Mobimatter Order ID to Shopify metafields
    const shopifyResponse = await fetch(`https://${process.env.SHOPIFY_DOMAIN}/admin/api/2024-01/orders/${shopifyOrderId}/metafields.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        metafield: {
          namespace: 'esim',
          key: 'qr_code',
          type: 'single_line_text_field',
          value: qrEntry.value,
        },
      }),
    });

    if (!shopifyResponse.ok) {
      const errorText = await shopifyResponse.text();
      return {
        statusCode: 500,
        body: `Shopify update failed: ${errorText}`,
      };
    }

    // Also store Mobimatter Order ID
    await fetch(`https://${process.env.SHOPIFY_DOMAIN}/admin/api/2024-01/orders/${shopifyOrderId}/metafields.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN,
        'Content-Type': 'application/json',
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
      body: 'QR code saved to Shopify order metafield',
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: `Error: ${error.message || error}`,
    };
  }
};
