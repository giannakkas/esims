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

    // 3️⃣ SEND MOBIMATTER EMAIL
    console.log("✉️ Preparing to send Mobimatter email...");

    const emailPayload = {
      orderId,
      customer: {
        id: `${shopifyOrderId}`,
        name: `${order?.shipping_address?.name || "No Name"}`,
        email,
        ccEmail: email,
        phone: order?.shipping_address?.phone || ""
      },
      amountCharged: Number(order?.total_price || 0),
      currency: `${order?.currency || "USD"}`,
      merchantOrderId: `ShopifyOrder-${shopifyOrderId}`
    };

    console.log("📦 Email Payload:", JSON.stringify(emailPayload, null, 2));

    try {
      const emailRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/plain",
          "api-key": MOBIMATTER_API_KEY,
          merchantId: MOBIMATTER_MERCHANT_ID
        },
        body: JSON.stringify(emailPayload)
      });

      const emailText = await emailRes.text();
      console.log(`📤 Email response (status ${emailRes.status}):`, emailText);

      if (!emailRes.ok) {
        console.warn("⚠️ Mobimatter email API returned a non-200 status");
        return {
          statusCode: emailRes.status,
          body: JSON.stringify({
            success: true,
            mobimatterOrderId: orderId,
            message: "Order completed, but email not sent",
            emailError: emailText
          })
        };
      }

      console.log("✅ Mobimatter email sent successfully");

    } catch (emailErr) {
      console.error("❌ Email send failed with error:", emailErr.message);
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: true,
          mobimatterOrderId: orderId,
          message: "Order completed, but email failed",
          error: emailErr.message
        })
      };
    }

    // 4️⃣ TRIGGER QR CODE STORAGE
    try {
      const triggerQr = await fetch(`https://esimszone.netlify.app/.netlify/functions/store-qr-code?shopifyOrderId=${shopifyOrderId}&mobimatterOrderId=${orderId}`);
      const qrText = await triggerQr.text();
      console.log("📌 QR Code sync triggered:", qrText);
    } catch (qrErr) {
      console.error("❌ Failed to trigger QR code sync:", qrErr.message);
    }

    // ✅ ALL DONE
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        mobimatterOrderId: orderId,
        message: "Order created, completed, email sent, and QR sync triggered"
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
