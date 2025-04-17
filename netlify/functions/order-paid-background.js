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
    const customerName = order?.customer?.first_name + " " + order?.customer?.last_name;
    const phone = order?.shipping_address?.phone || order?.phone || "";

    const productId = lineItem?.sku?.trim();
    const productCategory = "esim_realtime";
    const amountCharged = parseFloat(order?.total_price || 0);
    const currency = order?.currency || "USD";

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

    console.log("📦 Creating Mobimatter order:", createPayload);

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
    console.log("📨 Create response:", createText);

    if (!createRes.ok) {
      return {
        statusCode: createRes.status,
        body: JSON.stringify({ error: "Failed to create Mobimatter order", details: createText })
      };
    }

    const orderId = JSON.parse(createText)?.result?.orderId;
    if (!orderId) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Mobimatter did not return an order ID." })
      };
    }

    console.log("✅ Mobimatter order created:", orderId);

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
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID
      },
      body: JSON.stringify(completePayload)
    });

    const completeText = await completeRes.text();
    console.log("📬 Complete response (status:", completeRes.status + "):", completeText);

    if (!completeRes.ok) {
      return {
        statusCode: completeRes.status,
        body: JSON.stringify({
          error: "Failed to complete Mobimatter order",
          response: completeText
        })
      };
    }

    // 3️⃣ SEND EMAIL
    const emailPayload = {
      orderId,
      customer: {
        id: email,
        name: customerName || email,
        email: email,
        ccEmail: email,
        phone
      },
      amountCharged,
      currency,
      merchantOrderId: `ShopifyOrder-${shopifyOrderId}`
    };

    console.log("✉️ Sending Mobimatter email:", emailPayload);

    const emailRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
        "api-key": MOBIMATTER_API_KEY
      },
      body: JSON.stringify(emailPayload)
    });

    const emailText = await emailRes.text();
    console.log("📤 Email response (status:", emailRes.status + "):", emailText);

    if (!emailRes.ok) {
      return {
        statusCode: 207,
        body: JSON.stringify({
          warning: "Order completed but failed to send Mobimatter email",
          mobimatterOrderId: orderId,
          emailResponse: emailText
        })
      };
    }

    // ✅ DONE
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        mobimatterOrderId: orderId,
        message: "Order created, completed, and email sent."
      })
    };

  } catch (err) {
    console.error("❌ Unexpected error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unexpected error", message: err.message })
    };
  }
};
