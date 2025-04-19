exports.handler = async (event) => {
  const { orderId, email } = event.queryStringParameters;

  if (!orderId || !email) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing orderId or email' }),
    };
  }

  const fetch = (...args) =>
    import('node-fetch').then(({ default: fetch }) => fetch(...args));

  const apiKey = process.env.MOBIMATTER_API_KEY;
  const merchantId = process.env.MOBIMATTER_MERCHANT_ID;

  console.log('DEBUG: Using headers:', {
    apiKey: apiKey ? '[present]' : '[missing]',
    merchantId: merchantId ? '[present]' : '[missing]',
  });

  try {
    // STEP 1: Convert external order code to internal UUID
    const refRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/by-code/${orderId}`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'merchant-id': merchantId,
      },
    });

    const refRaw = await refRes.text();
    let refData;
    try {
      refData = JSON.parse(refRaw);
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Invalid JSON from /by-code', preview: refRaw.slice(0, 300) }),
      };
    }

    if (!refRes.ok || !refData.id) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Order not found', details: refData }),
      };
    }

    const internalId = refData.id;

    // STEP 2: Now call /usage with internal ID
    const usageRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${internalId}/usage`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'merchant-id': merchantId,
        'email': email
      },
    });

    const usageRaw = await usageRes.text();
    let usageData;
    try {
      usageData = JSON.parse(usageRaw);
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Invalid JSON from /usage', preview: usageRaw.slice(0, 300) }),
      };
    }

    if (!usageRes.ok) {
      return {
        statusCode: usageRes.status,
        body: JSON.stringify({ error: usageData.message || 'Usage fetch failed', details: usageData }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ usage: usageData }),
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', details: error.message }),
    };
  }
};
