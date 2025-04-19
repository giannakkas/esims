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

  console.log('⚙️ Step 1: Starting get-usage');
  console.log('🧾 Headers:', {
    apiKey: apiKey ? '[present]' : '[missing]',
    merchantId: merchantId ? '[present]' : '[missing]',
  });

  try {
    // STEP 1 — Look up internal order ID
    console.log(`🔍 Fetching internal ID for orderCode: ${orderId}`);
    const refRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/by-code/${orderId}`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'merchant-id': merchantId,
      },
    });

    const refRaw = await refRes.text();
    console.log('📨 Raw /by-code response:', refRaw.slice(0, 500));

    let refData;
    try {
      refData = JSON.parse(refRaw);
    } catch (err) {
      console.log('❌ JSON parse failed for /by-code');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Invalid JSON from /by-code', preview: refRaw.slice(0, 300) }),
      };
    }

    if (!refRes.ok || !refData.id) {
      console.log('🚫 Order not found or missing ID');
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Order not found', details: refData }),
      };
    }

    const internalId = refData.id;
    console.log(`✅ Found internal ID: ${internalId}`);

    // STEP 2 — Call usage endpoint
    console.log(`📡 Fetching usage for internal ID: ${internalId}`);
    const usageRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${internalId}/usage`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'merchant-id': merchantId,
        'email': email,
      },
    });

    const usageRaw = await usageRes.text();
    console.log('📨 Raw /usage response:', usageRaw.slice(0, 500));

    let usageData;
    try {
      usageData = JSON.parse(usageRaw);
    } catch (err) {
      console.log('❌ JSON parse failed for /usage');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Invalid JSON from /usage', preview: usageRaw.slice(0, 300) }),
      };
    }

    if (!usageRes.ok) {
      console.log('🚫 Usage fetch failed:', usageData.message || 'unknown error');
      return {
        statusCode: usageRes.status,
        body: JSON.stringify({ error: usageData.message || 'Usage fetch failed', details: usageData }),
      };
    }

    console.log('✅ Usage retrieved successfully');
    return {
      statusCode: 200,
      body: JSON.stringify({ usage: usageData }),
    };

  } catch (error) {
    console.log('❌ Server exception:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', details: error.message }),
    };
  }
};
