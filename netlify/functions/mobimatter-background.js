import { request } from 'undici';

export const handler = async function () {
  console.info('🚀 Mobimatter background sync started');

  try {
    const response = await request('https://api.mobimatter.com/mobimatter/api/v2/products');
    const data = await response.body.json();

    if (!data || !data.products || !Array.isArray(data.products)) {
      console.error('❌ Invalid Mobimatter API response:', JSON.stringify(data, null, 2));
      throw new Error('Invalid Mobimatter API response');
    }

    const products = data.products.slice(0, 10);
    console.info(`✅ Fetched ${products.length} products`);
    products.forEach((p, i) => {
      console.info(`➡️ Product ${i + 1}: ${p.title}`);
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Mobimatter sync completed', count: products.length }),
    };
  } catch (err) {
    console.error('❌ Sync failed:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
