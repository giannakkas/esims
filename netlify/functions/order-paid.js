const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  const {
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
  } = process.env;

  console.log("📦 Shopify webhook received.");

  // 1. Parse webhook payload safely
  let shopifyOrder;
  try {
    shopifyOrder = JSON.parse(event.body);
    console.log("✅ Webhook JSON parsed successfully.");
  } catch (parseError) {
    console.error("❌ Failed to parse webhook body. Raw body:", event.body);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON in webhook body" }),
    };
  }

  try {
    // 2. Extract required fields from the order
    const lineItem = shopifyOrder.line_items?.[0];
    const sku = lineItem?.sku;
    const customerEmail = shopifyOrder.email;
    const orderId = shopifyOrder.id;

    console.log("🔍 Extracted values:");
    console.log("   → SKU (Mobimatter uniqueId):", sku);
    console.log("   → Customer Email:", customerEmail);
    console.log("   → Shopify Order ID:", orderId);

    if (!sku || !customerEmail || !orderId) {
      throw new Error("Missing SKU, email, or order ID in webhook payload.");
    }

    // 3. Fetch Mobimatter products to find the correct internal productId
    console.log("🌐 Fetching Mobimatter product list to find productId...");
    const productsRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/products", {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    const productsJson = await productsRes.json();
    const products = productsJson?.result;

    if (!Array.isArray(products)) {
      throw new Error("Invalid product list received from Mobimatter");
    }

    const product = products.find((p) => p.uniqueId === sku);
    if (!product) {
      throw new Error(`No matching product found in Mobimatter for SKU: ${sku}`);
    }

    // 🧪 Debug: log full product object
    console.log("🔎 Matched Mobimatter product:");
    console.log(JSON.stringify(product, null, 2));

    const productId = product.productId || product.id;
    if (!productId) {
      throw new Error(`Product found for SKU ${sku}, but productId is missing`);
    }

    console.log("✅ Using Mobimatter productId:", productId);

    // 4. Create Mobimatter order
    console.log("📝 Creating Mobimatter order...");
    const createRes = await fetch("https://api.mobimatter.com/mobimatter/api/v1/order", {
      method: "POST",
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        productId,
        quantity: 1,
        customerEmail,
      }),
    });

    console.log("   → Mobimatter response status:", createRes.status);
    console.log("   → Headers:", JSON.stringify(Object.fromEntries(createRes.headers), null, 2));

    const createText = await createRes.text();
    if (!createText || createText.trim() === "") {
      throw new Error(`Mobimatter responded with empty body. Status: ${createRes.status}`);
    }

    console.log("   → Mobimatter raw response:", createText);

    let createData;
    try {
      createData = JSON.parse(createText);
    } catch (jsonErr) {
      console.error("❌ Mobimatter create order response not valid JSON. Raw text:", createText);
      throw new Error("Mobimatter create order response is not valid JSON");
    }

    const mobimatterOrderId = createData?.result?.orderId;
    if (!mobimatterOrderId) {
      throw new Error("Failed to create Mobimatter order. No orderId returned.");
    }

    console.log(`✅ Mobimatter order created: ${mobimatterOrderId}`);

    // 5. Complete Mobimatter order
    console.log("🔄 Completing Mobimatter order...");
    const completeRes = await fetch("https://api.mobimatter.com/mobimatter/api/v1/order/complete", {
      method: "POST",
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orderId: mobimatterOrderId }),
    });

    const completeText = await completeRes.text();
    console.log("   → Mobimatter complete response:", completeText);
    console.log("✅ Mobimatter order completed.");

    // 6. Fetch QR code
    console.log("🔍 Fetching activation QR code...");
    const qrRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v1/order/${mobimatterOrderId}`, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    const qrText = await qrRes.text();
    console.log("   → QR code response raw text:", qrText);

    let qrData;
    try {
      qrData = JSON.parse(qrText);
    } catch (err) {
      console.error("❌ Failed to parse QR code JSON:", err.message);
      throw new Error("Mobimatter QR code response is not valid JSON");
    }

    const qrUrl = qrData?.result?.activation?.imageUrl;
    if (!qrUrl) {
      throw new Error("QR code image URL not found in Mobimatter response.");
    }

    console.log(`🖼 QR code URL retrieved: ${qrUrl}`);

    // 7. Add QR to Shopify order note
    console.log("📝 Updating Shopify order note with QR code...");
    const noteRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-04/orders/${orderId}.json`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
      },
      body: JSON.stringify({
        order: {
          id: orderId,
          note: `✅ Your eSIM is ready!\nScan this QR Code to activate:\n${qrUrl}`,
        },
      }),
    });

    const noteJson = await noteRes.json();
    console.log("✅ Shopify order note updated successfully.");
    console.log("   → Final note:", noteJson?.order?.note);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "QR code generated and added to order note.",
        qrUrl,
      }),
    };
  } catch (error) {
    console.error("❌ Error in order-paid handler:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
