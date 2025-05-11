export async function handler(event) {
  const MOBIMATTER_API_KEY = process.env.MOBIMATTER_API_KEY;
  const MOBIMATTER_MERCHANT_ID = process.env.MOBIMATTER_MERCHANT_ID;

  const mobimatterRes = await fetch('https://api.mobimatter.com/mobimatter/api/v2/order/REVO-9801123', {
    method: 'GET',
    headers: {
      'Accept': 'text/plain',
      'merchantId': MOBIMATTER_MERCHANT_ID,
      'api-key': MOBIMATTER_API_KEY
    }
  });

  const data = await mobimatterRes.json();

  return {
    statusCode: 200,
    body: JSON.stringify(data, null, 2)
  };
}
