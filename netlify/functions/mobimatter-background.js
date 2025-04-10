import fetch from 'node-fetch';

export const handler = async function () {
  console.info('🚀 Mobimatter background sync started');

  try {
    // Fetch products from Mobimatter API
    const res = await fetch('https://api.mobimatter.com/mobimatter/api/v2/products');
    const data = await res.json();

    // Validate response structure
    if (!data || !data.products || !Array.isArray(data.products)) {
      console.error('❌ Unexpected Mobimatter API response:', JSON.stringify(data, null, 2));
      throw new Error('Invalid Mobimatter API response');
    }

    const products = data.products.slice(0, 10);
    console.info(`✅ Fetched ${products.length} products`);

    // 🧪 For now, just log the first product title to confirm
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
