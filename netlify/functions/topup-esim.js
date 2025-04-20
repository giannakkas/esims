// File: netlify/functions/topup-esim.js

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const { orderId, productId } = JSON.parse(event.body || '{}');

  if (!orderId || !productId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing orderId or productId' })
    };
  }

  const apiKey = process.env.MOBIMATTER_API_KEY;
  const merchantId = process.env.MOBIMATTER_MERCHANT_ID;

  if (!apiKey || !merchantId) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing Mobimatter credentials' })
    };
  }

  try {
    const fetch = (await import('node-fetch')).default;

    const response = await fetch('https://api.mobimatter.com/mobimatter/api/v2/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
        'merchantId': merchantId
      },
      body: JSON.stringify({
        productId,
        addOnIdentifier: orderId
      })
    });

    const result = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: result.message || 'Failed to create top-up order' })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(result)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Top-up error', message: error.message })
    };
  }
};
