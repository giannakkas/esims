// File: netlify/functions/get-usage.js

export default async (req, res) => {
  console.log('⚙️ Starting get-usage');

  const { orderId } = req.query;
  const apiKey = process.env.MOBIMATTER_API_KEY;
  const merchantId = process.env.MOBIMATTER_MERCHANT_ID;

  if (!orderId) {
    return res.status(400).json({ error: 'Missing orderId' });
  }
  if (!apiKey || !merchantId) {
    return res.status(500).json({ error: 'Missing API credentials' });
  }

  console.log('🔐 API Key:', '[present]');
  console.log('🏪 Merchant ID:', merchantId);
  console.log('📦 Order Code:', orderId);

  const endpoint = `https://api.mobimatter.com/mobimatter/api/v2/order/${orderId}`;

  try {
    const usageRes = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'apiKey': apiKey,
        'merchantId': merchantId,
        'Content-Type': 'application/json'
      }
    });

    const raw = await usageRes.text();
    console.log('📨 Raw response body:', raw);

    let json;
    try {
      json = JSON.parse(raw);
    } catch (parseError) {
      return res.status(500).json({ error: 'Invalid JSON in response', details: raw });
    }

    if (!usageRes.ok || json.statusCode === 404) {
      console.log('🚫 Mobimatter Error:', json.message);
      return res.status(usageRes.status).json({ error: json.message || 'Failed to fetch usage info' });
    }

    return res.status(200).json({ usage: json });
  } catch (err) {
    console.error('❌ Unexpected Error:', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
};
