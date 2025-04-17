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
    const productCategory = "esim_realtime"; // or dynamic later

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

    // 1️⃣ CREATE ORDER
    const createPayload = {
      productId,
      productCategory,
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
    console.log("📨 Mobimatter create response:", createText);

    if (!createRes.ok) {
      return {
        statusCode: createRes.status,
        body: JSON.stringify({ error: "Failed to create order", details: createText })
      };
    }

    let orderId;
    try {
      const createData = JSON.parse(createText);
      orderId = createData?.result?.orderId;
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Invalid response from create order" })
      };
    }

    if (!orderId) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "No orderId returned" })
      };
    }

    console.log("✅ Order created:", orderId);

    // 2️⃣ COMPLETE ORDER
    const completePayload = {
      orderId,
      notes: `Shopify Order ${shopifyOrderId}`
    };

    console.log("🧾 Completing order:", completePayload);

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
    console.log("📬 Complete order response:", completeText);

    if (!completeRes.ok) {
      return {
        statusCode: completeRes.status,
        body: JSON.stringify({ error: "Failed to complete order", details: completeText })
      };
    }

    // 3️⃣ POLL FOR ACTIVATION
    const MAX_ATTEMPTS = 6;
    const DELAY_MS = 5000;
    let activationUrl = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`🔄 Polling order status (attempt ${attempt})...`);

      const statusRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${orderId}`, {
        headers: {
          "api-key": MOBIMATTER_API_KEY,
          merchantId: MOBIMATTER_MERCHANT_ID
        }
      });

      const statusText = await statusRes.text();
      console.log(`📡 Status response (${attempt}):`, statusText);

      let statusJson = {};
      if (statusText) {
        try {
          statusJson = JSON.parse(statusText);
        } catch (err) {
          console.error("❌ Failed to parse status response:", err.message);
          break;
        }
      }

      activationUrl = statusJson?.result?.activation?.imageUrl;

      if (activationUrl) {
        console.log("✅ Activation ready:", activationUrl);
        break;
      }

      console.log("⏳ Activation not ready yet...");
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }

    if (!activationUrl) {
      console.warn("⚠️ QR not ready after polling. Order is pending.");
      return {
        statusCode: 202,
        body: JSON.stringify({
          success: true,
          mobimatterOrderId: orderId,
          message: "Order completed, but QR not ready yet."
        })
      };
    }

    // 4️⃣ RETURN SUCCESS
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        mobimatterOrderId: orderId,
        activationUrl,
        message: "Order created, completed, and QR ready"
      })
    };

  } catch (err) {
    console.error("❌ Unexpected error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unexpected error", message: err.message })
    };
  }
};
