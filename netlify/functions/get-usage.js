// File: netlify/functions/get-usage.js

export const handler = async (event) => {
  const { orderId } = event.queryStringParameters || {};

  if (!orderId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing orderId' }),
    };
  }

  const apiKey = process.env.MOBIMATTER_API_KEY;
  const merchantId = process.env.MOBIMATTER_MERCHANT_ID;

  if (!apiKey || !merchantId) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing API credentials' }),
    };
  }

  try {
    const fetch = (await import('node-fetch')).default;

    const response = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/provider/usage/${orderId}`, {
      headers: {
        Accept: 'text/plain',
        'api-key': apiKey,
        'merchantId': merchantId,
      },
    });

    const text = await response.text();

    try {
      const data = JSON.parse(text);

      if (!response.ok) {
        return {
          statusCode: response.status,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: data.message || 'Mobimatter error' }),
        };
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      };
    } catch (jsonErr) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON from Mobimatter', raw: text }),
      };
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Fetch error', message: err.message }),
    };
  }
};
