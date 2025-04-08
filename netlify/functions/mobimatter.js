// Use dynamic import for node-fetch to handle ESM compatibility
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

exports.handler = async function () {
  // Environment variables
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    MOBIMATTER_SUBSCRIPTION_KEY,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2025-04",
  } = process.env;

  // Initialize results
  const created = [];
  const failed = [];

  try {
    // 1. Fetch products from MobiMatter API
    const mobimatterUrl = "https://api.mobimatter.com/mobimatter/api/v2/products";
    const response = await fetch(mobimatterUrl, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        "merchantId": MOBIMATTER_MERCHANT_ID,
        "Ocp-Apim-Subscription-Key": MOBIMATTER_SUBSCRIPTION_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`MobiMatter API request failed: ${response.status} ${await response.text()}`);
    }

    const { result: products } = await response.json();

    // 2. Process products (limit to 10 for safety)
    for (const product of products.slice(0, 10)) {
      try {
        // Extract product details
        const details = {};
        (product.productDetails || []).forEach(({ name, value }) => {
          details[name.trim()] = value;
        });

        // Prepare product data
        const has5G = details.FIVEG === "1" ? "5G" : "4G";
        const speed = details.SPEED || "Unknown";
        const topUp = details.TOPUP === "1" ? "Available" : "Not available";
        const countries = (product.countries || []).map(c => `:flag-${c.toLowerCase()}:`).join(" ");
        const dataAmount = `${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}`;
        const validity = details.PLAN_VALIDITY || "?";
        const vendor = product.providerName || "Mobimatter";
        const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
        const price = product.retailPrice?.toFixed(2);

        if (!title || !price) {
          failed.push({ title: title || "(missing)", reason: "Missing title or price" });
          continue;
        }

        // Create Shopify product
        const mutation = `
          mutation productCreate($input: ProductInput!) {
            productCreate(input: $input) {
              product {
                id
                title
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const variables = {
          input: {
            title,
            descriptionHtml: `
              <p><strong>Network:</strong> ${has5G}</p>
              <p><strong>Speed:</strong> ${speed}</p>
              <p><strong>Top-up:</strong> ${topUp}</p>
              <p><strong>Countries:</strong> ${countries}</p>
              <p><strong>Data:</strong> ${dataAmount}</p>
              <p><strong>Validity:</strong> ${validity} days</p>
            `,
            vendor,
            productType: "eSIM",
            tags: [has5G, "eSIM"],
            status: "ACTIVE",
            images: product.providerLogo ? [{ src: product.providerLogo }] : undefined,
          },
        };

        const shopifyRes = await fetch(
          `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
            },
            body: JSON.stringify({ query: mutation, variables }),
          }
        );

        const shopifyJson = await shopifyRes.json();
        const errors = shopifyJson?.data?.productCreate?.userErrors;

        if (!shopifyRes.ok || (errors && errors.length)) {
          failed.push({
            title,
            reason: errors?.map(e => e.message).join(", ") || `Status ${shopifyRes.status}`,
          });
        } else {
          created.push(title);
        }
      } catch (productErr) {
        failed.push({
          title: product.productFamilyName || "Unknown Product",
          reason: productErr.message
        });
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: `Processed ${products.length} products`,
        created: created.length,
        failed: failed.length,
        details: { created, failed }
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: "Sync failed",
        message: err.message,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined
      }),
    };
  }
};
