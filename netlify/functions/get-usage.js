// File: netlify/functions/get-usage.js

export const handler = async (event) => {
  const { orderId } = event.queryStringParameters || {};

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://esimszone.com',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: 'OK',
    };
  }

  if (!orderId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing orderId' }),
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

    const response = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/provider/usage/${orderId}`, {
      headers: {
        Accept: 'application/json',
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
          headers,
          body: JSON.stringify({ error: data.message || 'Mobimatter error' }),
        };
      }

      // Bandwidth percentage calculations
      const balanceText = data?.providerInfo?.data?.balance || '';
      const match = balanceText.match(/used\s+(\d+(?:\.\d+)?)MB\s+out of\s+(\d+(?:\.\d+)?)/i);
      if (match) {
        const used = parseFloat(match[1]);
        const total = parseFloat(match[2]);
        const left = total - used;
        const percentUsed = parseFloat(((used / total) * 100).toFixed(1));
        const percentLeft = parseFloat((100 - percentUsed).toFixed(1));

        data.usage = {
          used,
          total,
          left,
          percentUsed,
          percentLeft
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(data),
      };
    } catch (jsonErr) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Invalid JSON from Mobimatter', raw: text }),
      };
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Fetch error', message: err.message }),
    };
  }
};
