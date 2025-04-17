const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  try {
    const {
      MOBIMATTER_API_KEY,
      MOBIMATTER_MERCHANT_ID
    } = process.env;

    const order = JSON.parse(event.body);
    const lineItem = order?.line_items?.[0];
    const email = order?.email;
    const shopifyOrderId = order?.id;

    const productId = lineItem?.sku?.trim();

    if (!productId || !email) {
      console.error("❌ Missing SKU or email. Order data:", {
        sku: lineItem?.sku,
        email,
        orderId: shopifyOrderId
      });

      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing SKU or email in Shopify order." })
      };
    }

    const createPayload = {
      productId,
      productCategory: "esim_realtime",
      label: `ShopifyOrder-${shopifyOrderId}`
    };

    console.log("📦 Creating Mobimatter order with payload:", createPayload);

    const createRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID
      },
      body: JSON.stringify(createPayload)
    });

    const createText = await createRes.text();
    console.log("📨 Mobimatter create response (raw):", createText);

    if (!createRes.ok) {
      console.error("❌ Mobimatter create API failed with status:", createRes.status);
      return {
        statusCode: createRes.status,
        body: JSON.stringify({ error: "Mobimatter order creation failed", response: createText })
      };
    }

    let orderId;
    try {
      const createData = JSON.parse(createText);
      orderId = createData?.result?.orderId; // ✅ Correct path
    } catch (err) {
      console.error("❌ JSON parse error from Mobimatter response:", err.message);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Failed to parse Mobimatter response" })
      };
    }

    if (!orderId) {
      console.error("❌ Missing orderId from Mobimatter:", createText);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "No orderId in Mobimatter response" })
      };
    }

    console.log("✅ Mobimatter order created:", orderId);

    // Step 2: Complete the Mobimatter order
    const completePayload = {
      orderId,
      notes: `Auto-completed from Shopify order ${shopifyOrderId}`
    };

    console.log("🧾 Completing Mobimatter order with payload:", completePayload);

    const completeRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order/complete", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
        "api-key": MOBIMATTER_API_KEY
      },
      body: JSON.stringify(completePayload)
    });

    const completeText = await completeRes.text();
    console.log("✅ Mobimatter complete response:", completeText);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        mobimatterOrderId: orderId,
        message: "Order created and completed"
      })
    };

  } catch (err) {
    console.error("❌ Fatal error in order-paid-background:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error", message: err.message })
    };
  }
};
