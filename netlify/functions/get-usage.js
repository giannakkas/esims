// netlify/functions/get-usage.js

export const handler = async (event) => {
  const { orderId } = event.queryStringParameters || {};

  if (!orderId) {
    return new Response(JSON.stringify({ error: 'Missing orderId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.MOBIMATTER_API_KEY;
  const merchantId = process.env.MOBIMATTER_MERCHANT_ID;

  try {
    const fetch = (await import('node-fetch')).default;

    const res = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/provider/usage/${orderId}`, {
      headers: {
        Accept: 'text/plain',
        'api-key': apiKey,
        'merchantId': merchantId,
      },
    });

    const text = await res.text();

    try {
      const json = JSON.parse(text);

      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (parseErr) {
      return new Response(JSON.stringify({ error: 'Mobimatter sent invalid JSON', raw: text }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Fetch failed', message: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
