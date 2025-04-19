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
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: error.message || 'Failed to fetch usage' }),
      };
    }

    const usage = await response.json();

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
