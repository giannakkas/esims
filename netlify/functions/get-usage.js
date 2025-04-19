// File: netlify/functions/get-usage.js

export async function handler(event) {
  const { orderId } = event.queryStringParameters || {};

  if (!orderId) {
    return new Response(JSON.stringify({ error: 'Missing orderId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.MOBIMATTER_API_KEY;
  const merchantId = process.env.MOBIMATTER_MERCHANT_ID;

  if (!apiKey || !merchantId) {
    return new Response(JSON.stringify({ error: 'Missing API credentials' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
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
        return new Response(JSON.stringify({ error: data.message || 'Mobimatter error' }), {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (jsonErr) {
      return new Response(JSON.stringify({ error: 'Invalid JSON from Mobimatter', raw: text }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Fetch error', message: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
