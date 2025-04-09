const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Map country codes to emoji flags
const getFlagEmoji = (countryCode) => {
  return countryCode.toUpperCase().replace(/./g, char => 
    String.fromCodePoint(127397 + char.charCodeAt())
  );
};

exports.handler = async () => {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2025-04"
  } = process.env;

  const MOBIMATTER_API_URL = "https://api.mobimatter.com/mobimatter/api/v2/products";
  const created = [];
  const failed = [];

  try {
    const res = await fetch(MOBIMATTER_API_URL, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        "merchantId": MOBIMATTER_MERCHANT_ID
      }
    });

    if (!res.ok) throw new Error(`Mobimatter fetch failed: ${res.status}`);
    const { result: products } = await res.json();

    for (const product of products.slice(0, 10)) {
      const details = {};
      (product.productDetails || []).forEach(({ name, value }) => {
        details[name.trim()] = value;
      });

      const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
      const price = product.retailPrice?.toFixed(2);
      const vendor = product.providerName || "Mobimatter";
      const countries = (product.countries || []).map(code => `${getFlagEmoji(code)} ${code}`).join(", ");
      const has5G = details.FIVEG === "1" ? "5G" : "4G";
      const dataAmount = `${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}`;
      const validity = details.PLAN_VALIDITY || "?";
      const speed = details.SPEED || "Unknown";
      const topUp = details.TOPUP === "1" ? "Available" : "Not available";
      const imageSrc = product.providerLogo;

      const descriptionHtml = `
        <div class="esim-description">
          <h3>${title}</h3>
          <p><strong>Countries:</strong> ${countries}</p>
          <p><strong>Data:</strong> ${dataAmount}</p>
          <p><strong>Validity:</strong> ${validity} days</p>
          <p><strong>Network:</strong> ${has5G}</p>
          <p><strong>Speed:</strong> ${speed}</p>
          <p><strong>Top-up:</strong> ${topUp}</p>
          <p><strong>Provider:</strong> ${vendor}</p>
        </div>
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
          tags: [has5G, `data-${dataAmount}`, ...product.countries.map(c => `country-${c}`)],
          status: "ACTIVE"
        }
      };

      // Step 1: Create the product
      const shopifyRes = await fetch(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY
          },
          body: JSON.stringify({ query: mutation, variables })
        }
      );

      const json = await shopifyRes.json();
      const productNode = json.data?.productCreate?.product;
      const errors = json.data?.productCreate?.userErrors;

      if (!shopifyRes.ok || errors?.length || !productNode?.id) {
        failed.push({ title, reason: errors?.map(e => e.message).join(", ") || "Unknown error" });
        continue;
      }

      // Step 2: Set the price and image via REST API
      const variantRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${productNode.id.split("/").pop()}.json`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY
        },
        body: JSON.stringify({
          product: {
            id: productNode.id.split("/").pop(),
            variants: [
              {
                price,
                inventory_quantity: 999999,
                inventory_management: "shopify"
              }
            ],
            images: imageSrc ? [{ src: imageSrc }] : []
          }
        })
      });

      if (!variantRes.ok) {
        failed.push({ title, reason: "Failed to update price/image" });
        continue;
      }

      created.push(title);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Created ${created.length} product(s)`,
        created,
        failed
      })
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
