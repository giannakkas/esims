const fetch = require("node-fetch");

exports.handler = async function () {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2023-10", // Keep it stable
  } = process.env;

  const mobimatterUrl = "https://api.mobimatter.com/mobimatter/api/v2/products";

  try {
    const response = await fetch(mobimatterUrl, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    if (!response.ok) {
      throw new Error(`Mobimatter fetch failed: ${response.status}`);
    }

    const { result: products } = await response.json();
    const created = [], failed = [];

    for (const product of products.slice(0, 10)) {
      const details = {};
      (product.productDetails || []).forEach(({ name, value }) => {
        details[name.trim()] = value;
      });

      const has5G = details.FIVEG === "1" ? "5G" : "4G";
      const speed = details.SPEED || "Unknown";
      const topUp = details.TOPUP === "1" ? "Available" : "Not available";
      const countries = (product.countries || []).map(c => `:flag-${c.toLowerCase()}:`).join(" ");
      const dataAmount = `${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}`;
      const validity = details.PLAN_VALIDITY || "?";
      const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
      const price = product.retailPrice?.toFixed(2);
      const sku = product.uniqueId;
      const image = product.providerLogo;

      const descriptionHtml = `
        <p><strong>Network:</strong> ${has5G}</p>
        <p><strong>Speed:</strong> ${speed}</p>
        <p><strong>Top-up:</strong> ${topUp}</p>
        <p><strong>Countries:</strong> ${countries}</p>
        <p><strong>Data:</strong> ${dataAmount}</p>
        <p><strong>Validity:</strong> ${validity} days</p>
      `;

      // First mutation: create product
      const productMutation = `
        mutation {
          productCreate(input: {
            title: "${title.replace(/"/g, '\\"')}",
            descriptionHtml: """${descriptionHtml.replace(/"""/g, '\\"\\"\\"')}""",
            vendor: "${product.providerName || "Mobimatter"}",
            productType: "eSIM",
            tags: ["${has5G}", "eSIM"],
            images: [{ src: "${image}" }]
          }) {
            product {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const productRes = await fetch(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          },
          body: JSON.stringify({ query: productMutation }),
        }
      );

      const productData = await productRes.json();
      const productId = productData?.data?.productCreate?.product?.id;
      const userErrors = productData?.data?.productCreate?.userErrors;

      if (!productId || (userErrors && userErrors.length > 0)) {
        failed.push({
          title,
          reason: userErrors?.[0]?.message || productData?.errors?.[0]?.message || "Failed to create product",
        });
        continue;
      }

      // Second mutation: create variant
      const variantMutation = `
        mutation {
          productVariantCreate(input: {
            productId: "${productId}",
            price: "${price}",
            sku: "${sku}",
            inventoryQuantity: 999999,
            inventoryManagement: "SHOPIFY",
            taxable: true
          }) {
            productVariant {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variantRes = await fetch(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          },
          body: JSON.stringify({ query: variantMutation }),
        }
      );

      const variantData = await variantRes.json();
      const variantErrors = variantData?.data?.productVariantCreate?.userErrors;

      if (variantErrors && variantErrors.length > 0) {
        failed.push({
          title,
          reason: variantErrors?.[0]?.message || "Failed to create variant",
        });
        continue;
      }

      created.push(title);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Created ${created.length} product(s)`, created, failed }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Mobimatter fetch or Shopify sync failed", message: err.message }),
    };
  }
};
