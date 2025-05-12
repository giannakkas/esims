// File: netlify/functions/get-usage.js

export const handler = async (event) => {
  console.log('🔍 Incoming request:', {
    httpMethod: event.httpMethod,
    queryStringParameters: event.queryStringParameters,
  });

  const { orderId } = event.queryStringParameters || {};

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://esimszone.com',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    console.log('✅ OPTIONS request - sending 200 OK');
    return {
      statusCode: 200,
      headers,
      body: 'OK',
    };
  }

  if (!orderId) {
    console.error('❌ Missing orderId');
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing orderId' }),
    };
  }

  const apiKey = process.env.MOBIMATTER_API_KEY;
  const merchantId = process.env.MOBIMATTER_MERCHANT_ID;

  if (!apiKey || !merchantId) {
    console.error('❌ Missing API credentials');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Missing API credentials' }),
    };
  }

  try {
    const fetch = (await import('node-fetch')).default;

    const mobimatterUrl = `https://api.mobimatter.com/mobimatter/api/v2/provider/usage/${orderId}`;
    console.log(`📡 Fetching usage from Mobimatter: ${mobimatterUrl}`);

    const response = await fetch(mobimatterUrl, {
      headers: {
        Accept: 'application/json',
        'api-key': apiKey,
        'merchantId': merchantId,
      },
    });

    const text = await response.text();
    console.log('📨 Raw response text:', text);

    try {
      const data = JSON.parse(text);
      console.log('✅ Parsed JSON:', data);

      if (!response.ok) {
        console.error('❌ Mobimatter responded with error status', response.status);
        return {
          statusCode: response.status,
          headers,
          body: JSON.stringify({ error: data.message || 'Mobimatter error' }),
        };
      }

      const balanceText = data?.providerInfo?.data?.balance || '';
      console.log('📊 Balance text:', balanceText);

      const match = balanceText.match(/used\s+(\d+(?:\.\d+)?)MB\s+out of\s+(\d+(?:\.\d+)?)/i);
      if (match) {
        const used = parseFloat(match[1]);
        const total = parseFloat(match[2]);
        const left = total - used;
        const percentUsed = parseFloat(((used / total) * 100).toFixed(1));
        const percentLeft = parseFloat((100 - percentUsed).toFixed(1));

        data.usage = { used, total, left, percentUsed, percentLeft };
        console.log('📈 Calculated usage:', data.usage);
      } else {
        console.log('ℹ️ Could not extract usage data from balance text.');
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(data),
      };
    } catch (jsonErr) {
      console.error('❌ JSON parse error:', jsonErr.message);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Invalid JSON from Mobimatter', raw: text }),
      };
    }
  } catch (err) {
    console.error('❌ Fetch error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Fetch error', message: err.message }),
    };
  }
};
