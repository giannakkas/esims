export async function handler(event) {
  try {
    const body = JSON.parse(event.body);
    const order = body;
    const lineItem = order.line_items?.[0];

    if (!lineItem?.sku) {
      console.error("❌ No SKU found in line items");
      return { statusCode: 400, body: "Missing SKU" };
    }

    const productId = lineItem.sku;
    const customerEmail = order.email;
    const shopifyOrderId = order.id;

    console.log("📦 Creating Mobimatter order with:", { productId, productCategory: "esim_realtime", label: `ShopifyOrder-${shopifyOrderId}` });

    const createRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.MOBIMATTER_API_KEY,
      },
      body: JSON.stringify({
        productId,
        productCategory: "esim_realtime",
        label: `ShopifyOrder-${shopifyOrderId}`,
      }),
    });

    const createData = await createRes.json();
    const orderId = createData?.result?.orderId;

    if (!orderId) {
      console.error("❌ Order creation failed", createData);
      return { statusCode: 500, body: "Mobimatter order creation failed" };
    }

    console.log(`✅ Order created: ${orderId}`);

    // Complete the order
    const completeRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${orderId}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.MOBIMATTER_API_KEY,
      },
      body: JSON.stringify({ orderId, notes: `Shopify Order ${shopifyOrderId}` }),
    });

    const completeData = await completeRes.json();
    console.log("📬 Complete order response:", completeData);

    // Poll for QR code
    const pollResult = await pollForQrCode(orderId);
    if (pollResult.success) {
      console.log("✅ QR code ready. Sending email...");
      await sendQrCodeEmail(orderId);
    } else {
      console.warn("⚠️ QR code not ready after polling.");
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error("❌ Uncaught error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

async function pollForQrCode(orderId, maxRetries = 6, delay = 5000) {
  for (let i = 0; i < maxRetries; i++) {
    console.log(`🔄 Polling order status (attempt ${i + 1})...`);
    const res = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${orderId}`, {
      headers: { "x-api-key": process.env.MOBIMATTER_API_KEY },
    });

    const data = await res.json();
    const activation = data?.result?.orderLineItem?.lineItemDetails?.find(
      (detail) => detail.name === "QR_CODE"
    );

    if (activation?.value?.startsWith("data:image")) {
      return { success: true, qrCode: activation.value };
    }

    console.log("⏳ Activation not ready yet...");
    await new Promise((res) => setTimeout(res, delay));
  }

  return { success: false };
}

async function sendQrCodeEmail(orderId) {
  const res = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${orderId}/send-email`, {
    method: "POST",
    headers: {
      "x-api-key": process.env.MOBIMATTER_API_KEY,
    },
  });

  if (res.ok) {
    console.log("📨 Email sent successfully");
  } else {
    const text = await res.text();
    console.error("❌ Failed to send email:", text);
  }
}
