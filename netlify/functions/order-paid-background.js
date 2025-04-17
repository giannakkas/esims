const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  try {
    const {
      MOBIMATTER_API_KEY
    } = process.env;

    const order = JSON.parse(event.body);

    const lineItem = order?.line_items?.[0];
    const productId = lineItem?.sku; // SKU must match Mobimatter uniqueId
    const email = order?.email;
    const shopifyOrderId = order?.id;

    if (!productId || !email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing productId or email" })
      };
    }

    const createPayload = {
      productId,
      productCategory: "esim_realtime", // Adjust if needed
      label: `ShopifyOrder-${shopifyOrderId}`
    };

    // STEP 1: Create Mobimatter order
    const createRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
        "api-key": MOBIMATTER_API_KEY
      },
      body: JSON.stringify(createPayload)
    });

    const createData = await createRes.json();
    const orderId = createData?.orderId;

    if (!orderId) {
      console.error("❌ Mobimatter order creation failed", createData);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Mobimatter order creation failed" })
      };
    }

    console.log("✅ Mobimatter Order Created:", orderId);

    // STEP 2: Complete Mobimatter order
    const completeRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order/complete", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
        "api-key": MOBIMATTER_API_KEY
      },
      body: JSON.stringify({
        orderId,
        notes: `Auto-completed for Shopify order ${shopifyOrderId}`
      })
    });

    const completeText = await completeRes.text();
    console.log("✅ Mobimatter Order Completed:", completeText);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        mobimatterOrderId: orderId,
        message: "Order created and completed"
      })
    };

  } catch (err) {
    console.error("❌ Error in order-paid:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" })
    };
  }
};
