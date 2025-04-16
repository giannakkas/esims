const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    console.log("⚠️ Invalid method:", event.httpMethod);
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  console.log("📦 Received new Shopify order webhook");

  try {
    const {
      MOBIMATTER_API_KEY,
      MOBIMATTER_MERCHANT_ID,
    } = process.env;

    console.log("🔑 Mobimatter Merchant ID:", MOBIMATTER_MERCHANT_ID);
    console.log("🔐 Mobimatter API Key Present:", !!MOBIMATTER_API_KEY);

    if (!MOBIMATTER_API_KEY || !MOBIMATTER_MERCHANT_ID) {
      console.error("❌ Missing API credentials in environment variables");
      return {
        statusCode: 500,
        body: "Missing Mobimatter API credentials",
      };
    }

    const order = JSON.parse(event.body);

    const email = order?.email;
    const lineItems = order?.line_items || [];

    console.log(`🧾 Order ID: ${order?.id}`);
    console.log(`📧 Customer email: ${email}`);
    console.log(`🛒 Line items: ${lineItems.length}`);

    if (!email || lineItems.length === 0) {
      console.error("❌ Missing email or line items in the order payload");
      return { statusCode: 400, body: "Invalid order data" };
    }

    const lineItem = lineItems[0];
    const productId = lineItem.sku;

    console.log("🔎 Extracted product ID from SKU:", productId);
    console.log("🧾 Line item title:", lineItem.title);

    if (!productId) {
      console.error("❌ Missing productId (SKU) in the order");
      return {
        statusCode: 400,
        body: "Missing productId (SKU) in order item",
      };
    }

    // === 1. Create Mobimatter Order ===
    console.log("📡 Creating Mobimatter order...");

    const createBody = {
      productId,
      customerEmail: email,
    };

    console.log("📦 Request payload to Mobimatter:", createBody);

    const createOrderRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": MOBIMATTER_API_KEY,
        "merchantid": MOBIMATTER_MERCHANT_ID,
      },
      body: JSON.stringify(createBody),
    });

    const createOrderData = await createOrderRes.json();
    console.log("📥 Mobimatter createOrder response:", createOrderData);

    const externalOrderCode = createOrderData?.result?.orderId;

    if (!createOrderRes.ok || !externalOrderCode) {
      console.error("❌ Mobimatter order creation failed:", createOrderData);
      return {
        statusCode: 500,
        body: "Mobimatter order creation failed",
      };
    }

    console.log("✅ Created Mobimatter order:", externalOrderCode);

    // === 2. Retry Fetch Internal Order ID ===
    let internalOrderId = null;
    const maxRetries = 10; // ⬅️ bumped to 10 retries

    for (let i = 0; i < maxRetries; i++) {
      console.log(`🔁 Attempt ${i + 1}: fetching internal order ID for ${externalOrderCode}`);

      const res = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/by-code/${externalOrderCode}`, {
        headers: {
          "Content-Type": "application/json",
          "api-key": MOBIMATTER_API_KEY,
          "merchantid": MOBIMATTER_MERCHANT_ID,
        },
      });

      const data = await res.json();

      if (res.ok && data?.result?.id) {
        internalOrderId = data.result.id;
        console.log("✅ Internal order ID found:", internalOrderId);
        break;
      }

      console.warn("❌ Not found yet:", data);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // wait 1 second
    }

    if (!internalOrderId) {
      console.error("❌ Failed to fetch internal Mobimatter order ID after retries.");
      return {
        statusCode: 500,
        body: "Failed to fetch internal Mobimatter order ID",
      };
    }

    // === 3. Complete Mobimatter Order ===
    console.log("📡 Completing Mobimatter order...");

    const completeRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${internalOrderId}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": MOBIMATTER_API_KEY,
        "merchantid": MOBIMATTER_MERCHANT_ID,
      },
    });

    if (!completeRes.ok) {
      const errText = await completeRes.text();
      console.error(`❌ Failed to complete order ${internalOrderId}:`, errText);
      return {
        statusCode: 500,
        body: "Mobimatter order completion failed",
      };
    }

    console.log("✅ Completed Mobimatter order:", internalOrderId);

    // === 4. Send Confirmation Email ===
    console.log("📧 Sending confirmation email to customer...");

    const sendEmailRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order/send-order-confirmation-to-customer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": MOBIMATTER_API_KEY,
        "merchantid": MOBIMATTER_MERCHANT_ID,
      },
      body: JSON.stringify({
        orderId: internalOrderId,
        customerEmail: email,
      }),
    });

    const sendEmailData = await sendEmailRes.json();
    console.log("📥 Mobimatter email send response:", sendEmailData);

    if (!sendEmailRes.ok) {
      console.error("❌ Failed to send confirmation email:", sendEmailData);
      return {
        statusCode: 500,
        body: "Mobimatter email send failed",
      };
    }

    console.log("✅ eSIM confirmation email sent to:", email);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "eSIM sent to customer", orderId: internalOrderId }),
    };

  } catch (err) {
    console.error("❌ Uncaught error:", err);
    return {
      statusCode: 500,
      body: "Unexpected error occurred",
    };
  }
};
