let fetch; // We'll load node-fetch dynamically

export async function handler(event, context) {
  if (!fetch) {
    fetch = (await import('node-fetch')).default;
  }

  try {
    const body = JSON.parse(event.body);
    const shopifyOrder = body;
    const lineItem = shopifyOrder.line_items?.[0];

    if (!lineItem || !lineItem.sku) {
      console.error("❌ No line item or SKU found");
      return { statusCode: 400, body: "No SKU in order" };
    }

    const customerEmail = shopifyOrder.email;
    const productId = lineItem.sku;

    // 1. Create the Mobimatter order
    const createOrderRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.MOBIMATTER_API_KEY,
      },
      body: JSON.stringify({
        productId,
        customerEmail,
      }),
    });

    const orderData = await createOrderRes.json();
    const { orderCode } = orderData;

    if (!orderCode) {
      console.error("❌ No orderCode returned:", orderData);
      return { statusCode: 500, body: "Mobimatter order creation failed" };
    }

    console.log(`✅ Created Mobimatter order: ${orderCode}`);

    // 2. Poll for QR code and send email when ready
    await pollForQrCode(orderCode, customerEmail);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error("❌ Error in order-paid-background:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}

async function pollForQrCode(orderCode, customerEmail, retries = 10, delayMs = 5000) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/by-code/${orderCode}`, {
      headers: {
        "x-api-key": process.env.MOBIMATTER_API_KEY,
      },
    });

    const data = await res.json();
    const internalOrderId = data?.id;
    const imageUrl = data?.activation?.imageUrl;

    if (internalOrderId && imageUrl) {
      console.log("✅ QR code is ready. Sending email...");
      await sendQrCodeEmail(internalOrderId);
      return;
    }

    console.log(`⏳ QR not ready (attempt ${i + 1}/${retries}). Retrying in ${delayMs / 1000}s...`);
    await new Promise((res) => setTimeout(res, delayMs));
  }

  console.error(`❌ QR code was not ready after ${retries} attempts`);
}

async function sendQrCodeEmail(orderId) {
  const res = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${orderId}/send-email`, {
    method: "POST",
    headers: {
      "x-api-key": process.env.MOBIMATTER_API_KEY,
    },
  });

  if (res.ok) {
    console.log("✅ Email sent via Mobimatter");
  } else {
    console.error("❌ Failed to send email via Mobimatter", await res.text());
  }
}
