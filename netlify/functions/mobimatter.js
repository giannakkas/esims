const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async () => {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2025-04",
  } = process.env;

  const MOBIMATTER_API_URL = "https://api.mobimatter.com/mobimatter/api/v2/products";
  const created = [];
  const failed = [];

  try {
    const response = await fetch(MOBIMATTER_API_URL, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        "merchantId": MOBIMATTER_MERCHANT_ID
      }
    });

    if (!response.ok) {
      throw new Error(`Mobimatter fetch failed: ${response.status}`);
    }

    const { result: products } = await response.json();

    for (const product of products.slice(0, 10)) {
      const details = {};
      (product.productDetails || []).forEach(({ name, value }) => {
        details[name.trim()] = value;
      });

      const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
      const price = product.retailPrice?.toFixed(2);
      const has5G = details.FIVEG === "1" ? "5G" : "4G";
      const speed = details.SPEED || "Unknown";
      const topUp = details.TOPUP === "1" ? "Available" : "Not available";
      const countries = (product.countries || []).map(c => `:flag-${c.toLowerCase()}:`).join(" ");
      const dataAmount = `${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}`;
      const validity = details.PLAN_VALIDITY || "?";
      const vendor = product.providerName || "Mobimatter";

      if (!title || !price) {
        failed.push({ title: title || "(missing)", reason: "Missing title or price" });
        continue;
      }

      const descriptionHtml = `
        <p><strong>Network:</strong> ${has5G}</p>
        <p><strong>Speed:</strong> ${speed}</p>
        <p><strong>Top-up:</strong> ${topUp}</p>
        <p><strong>Countries:</strong> ${countries}</p>
        <p><strong>Data:</strong> ${dataAmount}</p>
        <p><strong>Validity:</strong> ${validity} days</p>
      `;

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
          descriptionHtml,
          vendor,
          productType: "eSIM",
          tags: [has5G, "eSIM", ...product.countries.map(c => `country-${c}`)],
          status: "ACTIVE"
        }
      };

      const shopifyResponse = await fetch(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          },
          body: JSON.stringify({ query: mutation, variables })
        }
      );

      const shopifyJson = await shopifyResponse.json();
      const userErrors = shopifyJson?.data?.productCreate?.userErrors;

      if (!shopifyResponse.ok || (userErrors && userErrors.length > 0)) {
        failed.push({
          title,
          reason: userErrors.map(e => e.message).join(", ") || `Status ${shopifyResponse.status}`
        });
      } else {
        created.push(title);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Created ${created.length} product(s)`, created, failed })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Mobimatter fetch or Shopify sync failed",
        message: err.message
      })
    };
  }
};
