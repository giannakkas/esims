// Define the Mobimatter order creation endpoint. Make sure this is the correct one!
const MOBIMATTER_CREATE_ORDER_URL = 'https://api.mobimatter.com/mobimatter/api/v2/orders';

async function createMobimatterOrder(orderData) {
  try {
    const response = await fetch(MOBIMATTER_CREATE_ORDER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': process.env.MOBIMATTER_API_KEY,
        'merchantId': process.env.MOBIMATTER_MERCHANT_ID
      },
      body: JSON.stringify(orderData)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw { statusCode: response.status, message: errorBody };
    }

    const result = await response.json();
    return result;
  } catch (err) {
    console.error('Error creating Mobimatter order:', err);
    throw err;
  }
}

// Example usage in your webhook:
exports.handler = async (event) => {
  const orderId = /* extract Shopify order id from event */;
  
  // Build the order payload for Mobimatter. Make sure to include all required fields.
  const mobimatterPayload = {
    shopifyOrderId: orderId,
    // ... add your details (customer info, product SKU, etc.)
  };

  try {
    console.log(`Creating Mobimatter order for Shopify order ${orderId}...`);
    const mobimatterResult = await createMobimatterOrder(mobimatterPayload);
    console.log('Mobimatter order created successfully:', mobimatterResult);
    
    // Continue with completing the order and retrieving the QR code, etc.
    
  } catch (err) {
    console.error(`Failed to create Mobimatter order for order ${orderId}:`, err);
    // Return appropriate error response
    return { statusCode: 500, body: JSON.stringify({ error: err.message || err }) };
  }
  // ... further processing and setting order metafields in Shopify ...
};
