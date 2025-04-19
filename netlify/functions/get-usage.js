// File: netlify/functions/get-usage.js

export const handler = async (event) => {
  const { orderId, email } = event.queryStringParameters || {};

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

  if (!orderId && !email) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing orderId or email' }),
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

    let targetOrderId = orderId;

    // If only email is provided, attempt to fetch order by email
    if (!orderId && email) {
      const emailRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/by-email/${email}`, {
        headers: {
          Accept: 'application/json',
          'api-key': apiKey,
          'merchantId': merchantId,
        },
      });

      const emailData = await emailRes.json();

      if (!emailRes.ok || !emailData?.orderCode) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Order not found for provided email' }),
        };
      }

      targetOrderId = emailData.orderCode;
    }

    const response = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/provider/usage/${targetOrderId}`, {
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
