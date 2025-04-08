const fetch = require("node-fetch");

exports.handler = async function () {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    MOBIMATTER_SUBSCRIPTION_KEY, // NEW REQUIRED KEY
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2025-04",
  } = process.env;

  const mobimatterUrl = "https://api.mobimatter.com/mobimatter/api/v2/products";
  const created = [];
  const failed = [];

  try {
    // 1. Fetch products from MobiMatter (with subscription key)
    const response = await fetch(mobimatterUrl, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        "merchantId": MOBIMATTER_MERCHANT_ID,
        "Ocp-Apim-Subscription-Key": MOBIMATTER_SUBSCRIPTION_KEY // CRITICAL ADDITION
      }
    });

    if (!response.ok) {
      throw new Error(`MobiMatter API failed: ${response.status} ${await response.text()}`);
    }

    const { result: products } = await response.json();

    // 2. Process products (limited to 10 for safety)
    for (const product of products.slice(0, 10)) {
      try {
        // ... [rest of your existing product processing logic] ...

        // 3. Create Shopify product
        const shopifyRes = await fetch(
          `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
            },
            body: JSON.stringify({ 
              query: mutation, 
              variables 
            }),
          }
        );

        // ... [rest of your Shopify response handling] ...

      } catch (productErr) {
        failed.push({
          title: product.productFamilyName || "Unknown Product",
          reason: productErr.message
        });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true,
        created: created.length,
        failed: failed.length,
        details: { created, failed }
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: "Sync failed",
        message: err.message,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined
      }),
    };
  }
};
