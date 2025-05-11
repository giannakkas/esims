export async function handler(event) {
  const MOBIMATTER_API_KEY = process.env.MOBIMATTER_API_KEY;
  const MOBIMATTER_MERCHANT_ID = process.env.MOBIMATTER_MERCHANT_ID;

  if (!MOBIMATTER_API_KEY || !MOBIMATTER_MERCHANT_ID) {
    return {
      statusCode: 500,
      body: 'Missing Mobimatter API keys from environment'
    };
  }

  const mobimatterRes = await fetch('https://api.mobimatter.com/mobimatter/api/v2/order/REVO-9801123', {
    method: 'GET',
    headers: {
      'x-api-key': MOBIMATTER_API_KEY,
      'x-merchant-id': MOBIMATTER_MERCHANT_ID
    }
  });

  const body = await mobimatterRes.text();

  return {
    statusCode: mobimatterRes.status,
    body: `Mobimatter Status: ${mobimatterRes.status}\n\nResponse:\n${body}`
  };
}
