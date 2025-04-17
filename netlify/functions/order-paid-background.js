const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  try {
    const body = JSON.parse(event.body);
    const shopifyOrder = body; // webhook payload from Shopify

    const lineItem = shopifyOrder.line_items?.[0];
    if (!lineItem || !lineItem.sku) {
      console.error("❌ No SKU in order line item");
      return { statusCode: 400, body: "No SKU found in order" };
    }

    const productId = lineItem.sku;
    const shopifyOrderId = shopifyOrder.id;
    const customerEmail = shopifyOrder.email;

    const label = `ShopifyOrder-${shopifyOrderId}`;
    console.log("📦 Creating Mobimatter order with payload:", {
      productId,
      productCategory: "esim_realtime",
      label,
    });

    // 1. Create the order
    const createRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MOBIMATTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        productId,
        productCategory: "esim_realtime",
        label,
      }),
    });

    const createJson = await createRes.json();
    console.log("📨 Mobimatter create response:", JSON.stringify(createJson));

    const orderId = createJson.result?.orderId;
    if (!orderId) {
      console.error("❌ Failed to create Mobimatter order");
      return { statusCode: 500, body: "Order creation failed" };
    }

    console.log("✅ Order created:", orderId);

    // 2. Complete the order
    console.log("🧾 Completing order:", { orderId, notes: `Shopify Order ${shopifyOrderId}` });

    const completeRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${orderId}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MOBIMATTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        notes: `Shopify Order ${shopifyOrderId}`,
      }),
    });

    const completeJson = await completeRes.json();
    console.log("📬 Complete order response (status:", completeRes.status, "):", JSON.stringify(completeJson));

    // 3. Poll until QR code is ready
    const qrCode = await pollForQrCode(orderId, customerEmail);

    if (qrCode) {
      console.log("🎉 Order fulfilled successfully!");
      return { statusCode: 200, body: "Order fulfilled with QR" };
    } else {
      console.warn("⚠️ QR not ready after polling. Order is pending.");
      return { statusCode: 202, body: "Order pending, QR not ready yet" };
    }
  } catch (err) {
    console.error("❌ Error handling order-paid webhook:", err);
    return { statusCode: 500, body: "Internal Server Error" };
  }
};

// ========== Helper Functions ========== //

function isQrCodeReady(details) {
  const qr = details.find(d => d.name === "QR_CODE")?.value;
  return qr && qr.startsWith("data:image/");
}

function extractQrAndEmail(details) {
  const qrCode = details.find(d => d.name === "QR_CODE")?.value;
  const email = details.find(d => d.name === "CONFIRMATION_EMAIL")?.value || null;
  return { qrCode, email };
}

async function pollForQrCode(orderId, fallbackEmail, maxAttempts = 6, intervalMs = 5000) {
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;
    console.log(`🔄 Polling order status (attempt ${attempt})...`);

    const statusRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${orderId}`, {
      headers: { Authorization: `Bearer ${process.env.MOBIMATTER_API_KEY}` },
    });

    const statusJson = await statusRes.json();
    const details = statusJson.result?.orderLineItem?.lineItemDetails || [];

    console.log(`📡 Status response (${attempt}):`, JSON.stringify(statusJson));

    if (isQrCodeReady(details)) {
      const { qrCode, email } = extractQrAndEmail(details);
      console.log("✅ QR is ready!");
      console.log("📎 QR Code (truncated):", qrCode.substring(0, 100));

      // Send email via Mobimatter
      await sendQrCodeEmail(orderId, email || fallbackEmail);
      return qrCode;
    }

    console.log("⏳ Activation not ready yet...");
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return null;
}

async function sendQrCodeEmail(orderId, email) {
  console.log(`📤 Sending QR code email to ${email}`);
  const res = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order/send-email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MOBIMATTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      orderId,
      recipientEmail: email,
    }),
  });

  const json = await res.json();
  console.log("📬 Mobimatter email response:", JSON.stringify(json));
}
