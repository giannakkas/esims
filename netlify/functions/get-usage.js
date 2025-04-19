const fetch = require('node-fetch');

exports.handler = async (event) => {
  const { orderId } = event.queryStringParameters;

  if (!orderId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing orderId' }),
    };
  }

  try {
    const response = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${orderId}/usage`, {
      method: 'GET',
      headers: {
        'x-api-key': process.env.MOBIMATTER_API_KEY,
        'merchant-id': process.env.MOBIMATTER_MERCHANT_ID
      }
    });

    const raw = await response.text(); // read as plain text
    let usage;

    try {
      usage = JSON.parse(raw); // attempt to parse
    } catch (parseError) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Invalid JSON from Mobimatter', raw }),
      };
    }

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: usage.message || 'Failed to fetch usage' }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ usage }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', details: error.message }),
    };
  }
};
