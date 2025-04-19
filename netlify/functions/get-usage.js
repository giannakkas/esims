exports.handler = async (event) => {
  const { orderId } = event.queryStringParameters;

  if (!orderId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing orderId' }),
    };
  }

  const MOBIMATTER_API_KEY = process.env.MOBIMATTER_API_KEY;
  const MOBIMATTER_MERCHANT_ID = process.env.MOBIMATTER_MERCHANT_ID;

  console.log('⚙️ Step 1: Starting get-usage');
  console.log('🔐 API Key:', MOBIMATTER_API_KEY ? '[present]' : '[missing]');
  console.log('🏪 Merchant ID:', MOBIMATTER_MERCHANT_ID || '[missing]');
  console.log('🧾 Order ID:', orderId);

  try {
    const fetch = (await import('node-fetch')).default;

    const response = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${orderId}/usage`, {
      headers: {
        'x-api-key': MOBIMATTER_API_KEY,
        'merchantId': MOBIMATTER_MERCHANT_ID,
      }
    });

    const content = await response.text();

    try {
      const data = JSON.parse(content);

      if (!response.ok) {
        return {
          statusCode: response.status,
          body: JSON.stringify({ error: data.message || 'Failed to fetch usage' }),
        };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          usage: {
            remainingData: data.planData,
            usedData: data.usedData,
            remainingValidity: data.validityDays + ' days',
          }
        }),
      };
    } catch (parseErr) {
      console.error('❌ JSON parse error:', content);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Invalid JSON response from Mobimatter' }),
      };
    }
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', message: error.message }),
    };
  }
};

