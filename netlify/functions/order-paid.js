const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const {
      MOBIMATTER_API_KEY,
      MOBIMATTER_MERCHANT_ID,
    } = process.env;

    const order = JSON.parse(event.body);

    const email = order?.email;
    const lineItems = order?.line_items || [];

    if (!email || !lineItems.length) {
      return { statusCode: 400, body: "Invalid order data" };
    }

    // Get the Mobimatter uniqueId from SKU or product title
    const lineItem = lineItems[0]; // assuming only 1 eSIM per order
    const productId = lineItem.sku || lineItem.title.split("mobimatter-")[1];

    if (!productId) {
      return { statusCode: 400, body: "Product ID not found" };
    }

    // === 1. Create Mobimatter Order ===
    const createOrderRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": MOBIMATTER_API_KEY,
        "merchantId": MOBIMATTER_MERCHANT_ID,
      },
      body: JSON.stringify({
        productUniqueId: productId,
        customerEmail: email,
      }),
    });

    const createOrderData = await createOrderRes.json();
    const orderId = createOrderData?.orderId;

    if (!orderId) {
      console.error("❌ Mobimatter order creation failed:", createOrderData);
      return { statusCode: 500, body: "Failed to create Mobimatter order" };
    }

    // === 2. Complete Mobimatter Order ===
    await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${orderId}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": MOBIMATTER_API_KEY,
        "merchantId": MOBIMATTER_MERCHANT_ID,
      },
    });

    // === 3. Send Email Confirmation with QR Code ===
    await fetch("https://api.mobimatter.com/mobimatter/api/v2/order/send-order-confirmation-to-customer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": MOBIMATTER_API_KEY,
        "merchantId": MOBIMATTER_MERCHANT_ID,
      },
      body: JSON.stringify({
        orderId,
        customerEmail: email,
      }),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "eSIM sent to customer!", orderId }),
    };

  } catch (err) {
    console.error("❌ Error handling order:", err);
    return {
      statusCode: 500,
      body: "Internal Server Error",
    };
  }
};
