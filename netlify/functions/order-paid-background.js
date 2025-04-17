const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const axios = require('axios');

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
    const customerName = `${order?.customer?.first_name || ""} ${order?.customer?.last_name || ""}`.trim();
    const currency = order?.currency || "EUR";
    const amount = parseFloat(order?.current_total_price || 0);

    const productId = lineItem?.sku?.trim();
    const productCategory = "esim_realtime";

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
    console.log(`📬 Complete response (status: ${completeRes.status}):`, completeText);

    if (!completeRes.ok) {
      return {
        statusCode: completeRes.status,
        body: JSON.stringify({
          error: "Failed to complete Mobimatter order",
          status: completeRes.status,
          response: completeText
        })
      };
    }

    // 3️⃣ SEND EMAIL CONFIRMATION
    const emailPayload = {
      orderId,
      customer: {
        id: `${shopifyOrderId}`,
        name: customerName || email,
        email,
        ccEmail: email,
        phone: ""
      },
      amountCharged: amount,
      currency: currency,
      merchantOrderId: `ShopifyOrder-${shopifyOrderId}`
    };

    console.log("✉️ Sending Mobimatter email:", emailPayload);

    const emailRes = await axios.post("https://api.mobimatter.com/mobimatter/api/v2/email", emailPayload, {
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
        "api-key": MOBIMATTER_API_KEY
      }
    });

    console.log("📤 Email sent! Mobimatter response:", emailRes.data);

    // ✅ FINAL RESPONSE
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        mobimatterOrderId: orderId,
        message: "Order created, completed, and email sent"
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
