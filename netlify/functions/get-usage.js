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

    const raw = await response.text();
    console.log('📦 Raw Response:', raw);

    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      console.error('❌ Failed to parse JSON:', e.message);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Invalid JSON response', raw }),
      };
    }

    if (!response.ok) {
      console.error('❌ Mobimatter Error:', json.message || 'Unknown');
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: json.message || 'Failed to fetch usage' }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        usage: {
          remainingData: json.planData,
          usedData: json.usedData,
          remainingValidity: json.validityDays + ' days',
        }
      }),
    };
  } catch (error) {
    console.error('❌ Exception thrown:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', message: error.message }),
    };
  }
};
