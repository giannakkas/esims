exports.handler = async (event) => {
  const { orderId } = event.queryStringParameters;

  if (!orderId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing orderId' }),
    };
  }

  const fetch = (await import('node-fetch')).default;

  const apiKey = process.env.MOBIMATTER_API_KEY;
  const merchantId = process.env.MOBIMATTER_MERCHANT_ID;

  console.log('⚙️ Starting get-usage');
  console.log('🔐 API Key:', apiKey ? '[present]' : '[missing]');
  console.log('🏪 Merchant ID:', merchantId || '[missing]');
  console.log('📦 Order Code:', orderId);

  try {
    // Step 1: Lookup internal ID from order code
    const lookupRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/by-code/${orderId}`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'merchant-id': merchantId,
      }
    });

    const lookupRaw = await lookupRes.text();
    console.log('🔍 /by-code response:', lookupRaw.slice(0, 500));

    let lookupJson;
    try {
      lookupJson = JSON.parse(lookupRaw);
    } catch (e) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Invalid JSON from /by-code', raw: lookupRaw }),
      };
    }

    if (!lookupRes.ok || !lookupJson.id) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Order not found', details: lookupJson }),
      };
    }

    const internalId = lookupJson.id;
    console.log('✅ Internal Order ID:', internalId);

    // Step 2: Get usage info from internal ID
    const usageRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${internalId}/usage`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'merchant-id': merchantId,
      }
    });

    const usageRaw = await usageRes.text();
    console.log('📡 /usage response:', usageRaw.slice(0, 500));

    let usageJson;
    try {
      usageJson = JSON.parse(usageRaw);
    } catch (e) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Invalid JSON from /usage', raw: usageRaw }),
      };
    }

    if (!usageRes.ok) {
      return {
        statusCode: usageRes.status,
        body: JSON.stringify({ error: usageJson.message || 'Usage fetch failed' }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        usage: {
          remainingData: usageJson.planData || 'N/A',
          usedData: usageJson.usedData || 'N/A',
          remainingValidity: (usageJson.validityDays || 'N/A') + ' days',
        }
      }),
    };

  } catch (err) {
    console.error('❌ Exception:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected server error', message: err.message }),
    };
  }
};
