const fetch = require('node-fetch');

exports.handler = async (event) => {
  const { orderId } = event.queryStringParameters;

  if (!orderId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing orderId' }),
    };
  }

  const apiKey = process.env.MOBIMATTER_API_KEY;
  const merchantId = process.env.MOBIMATTER_MERCHANT_ID;

  // Log headers for debugging
  console.log('DEBUG: Using headers:', {
    apiKey: apiKey ? '[present]' : '[missing]',
    merchantId: merchantId ? '[present]' : '[missing]'
  });

  try {
    const response = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${orderId}/usage`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'merchant-id': merchantId
      }
    });

    const raw = await response.text(); // Read raw response body
    console.log('DEBUG: Raw response body:', raw.slice(0, 300)); // Log a snippet

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Invalid JSON response from Mobimatter',
          preview: raw.slice(0, 300)
        }),
      };
    }

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: parsed.message || 'Mobimatter error',
          details: parsed
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ usage: parsed }),
    };

  } catch (error) {
    console.error('Server exception:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', details: error.message }),
    };
  }
};
