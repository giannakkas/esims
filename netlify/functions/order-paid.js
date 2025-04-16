const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
  } = process.env;

  const body = JSON.parse(event.body);
  const email = body?.email;
  const lineItems = body?.line_items || [];

  if (!email || lineItems.length === 0) {
    return { statusCode: 400, body: "Invalid order data" };
  }

  // Find Mobimatter product SKU
  const esimItem = lineItems.find(item => item.sku?.startsWith("mobimatter-"));
  const productId = esimItem?.sku?.replace("mobimatter-", "");

  if (!productId) {
    return { statusCode: 400, body: "No Mobimatter product in order" };
  }

  try {
    // 1. Create Mobimatter Order
    const createRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order", {
      method: "POST",
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        productId,
        quantity: 1,
        email
      })
    });

    const { id: orderId } = await createRes.json();

    if (!orderId) throw new Error("Failed to create Mobimatter order");

    // 2. Trigger background check
    await fetch(`${process.env.URL}/.netlify/functions/qr-checker`, {
      method: "POST",
      body: JSON.stringify({ orderId, email }),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, orderId }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
