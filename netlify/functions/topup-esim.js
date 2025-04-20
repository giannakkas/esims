// File: netlify/functions/topup-esim.js

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: 'OK',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const { addOnIdentifier, productId } = JSON.parse(event.body || '{}');

  if (!addOnIdentifier || !productId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing addOnIdentifier or productId' }),
    };
  }

  const apiKey = process.env.MOBIMATTER_API_KEY;
  const merchantId = process.env.MOBIMATTER_MERCHANT_ID;

  if (!apiKey || !merchantId) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Missing API credentials' }),
    };
  }

  try {
    const fetch = (await import('node-fetch')).default;

    const response = await fetch('https://api.mobimatter.com/mobimatter/api/v2/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
        'merchantId': merchantId,
      },
      body: JSON.stringify({
        productId: productId,
        addOnIdentifier: addOnIdentifier,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: result.message || 'Top-up failed' }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Fetch error', message: err.message }),
    };
  }
};
