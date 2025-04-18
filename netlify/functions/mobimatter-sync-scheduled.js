import fetch from 'node-fetch'; // Make sure node-fetch is installed

const getCountryDisplay = (code) => {
  if (!code || code.length !== 2) return `🌐 ${code}`;
  const flag = code
    .toUpperCase()
    .replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt()));
  const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase());
  return `${flag} ${name || code}`;
};

const getProductDetails = (product) => {
  const details = {};
  (product.productDetails || []).forEach(({ name, value }) => {
    details[name.trim()] = value;
  });
  return details;
};

const buildDescription = (product, details) => {
  const countries = (product.countries || [])
    .map((c) => `<li>${getCountryDisplay(c)}</li>`)
    .join("");

  const rawValidity = details.PLAN_VALIDITY || "";
  const validityInDays = /^\d+$/.test(rawValidity)
    ? `${parseInt(rawValidity) / 24} days`
    : rawValidity;

  return `
    <div class="esim-description">
      <h3>${details.PLAN_TITLE || product.productFamilyName || "eSIM Plan"}</h3>
      <div class="countries-section">
        <p><strong>Countries:</strong></p>
        <ul>${countries}</ul>
      </div>
      <p><strong>Data:</strong> ${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}</p>
      <p><strong>Validity:</strong> ${validityInDays}</p>
      <p><strong>Network:</strong> ${details.FIVEG === "1" ? "📶 5G Supported" : "📱 4G Supported"}</p>
      ${details.SPEED ? `<p><strong>Speed:</strong> ${details.SPEED}</p>` : ""}
      ${details.TOPUP === "1" ? "<p><strong>Top-up:</strong> Available</p>" : ""}
      <p><strong>Calls:</strong> ${details.HAS_CALLS === "1" ? (details.CALL_MINUTES ? `${details.CALL_MINUTES} minutes` : "Available") : "Not available"}</p>
      <p><strong>SMS:</strong> ${details.HAS_SMS === "1" ? (details.SMS_COUNT ? `${details.SMS_COUNT} SMS` : "Available") : "Not available"}</p>
      <p><strong>Price:</strong> $${product.retailPrice?.toFixed(2) || "N/A"}</p>
      <p><strong>Provider:</strong> ${product.providerName || "Mobimatter"}</p>
    </div>
  `;
};

export const handler = async (event) => {
  console.log("✅ Function started");

  if (event.httpMethod !== "POST" && event.headers["x-scheduled-function"] !== "true") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2025-04",
  } = process.env;

  console.log("🔍 ENV CHECK", {
    hasMobimatterKey: !!MOBIMATTER_API_KEY,
    hasMerchant: !!MOBIMATTER_MERCHANT_ID,
    hasShopifyKey: !!SHOPIFY_ADMIN_API_KEY,
    domain: SHOPIFY_STORE_DOMAIN,
  });

  const MOBIMATTER_API_URL = "https://api.mobimatter.com/mobimatter/api/v2/products";
  const created = [], skipped = [], failed = [], removed = [];

  try {
    console.log("📡 Fetching from Mobimatter API...");
    const response = await fetch(MOBIMATTER_API_URL, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    if (!response.ok) throw new Error(`Mobimatter fetch failed: ${response.status}`);
    const data = await response.json();
    const products = data?.result?.slice(0, 5);
    if (!Array.isArray(products)) throw new Error("Invalid product array from Mobimatter");

    const mobimatterHandles = new Set(products.map(p => `mobimatter-${p.uniqueId}`.toLowerCase()));

    // 🔍 Get existing Shopify products
    const shopifyQuery = `
      {
        products(first: 250, query: "handle:mobimatter-") {
          edges {
            node { id handle title }
          }
        }
      }
    `;

    const shopifyRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
      },
      body: JSON.stringify({ query: shopifyQuery }),
    });

    const shopifyJson = await shopifyRes.json();
    const existingProducts = shopifyJson?.data?.products?.edges || [];

    // ❌ Delete products that are no longer in Mobimatter
    for (const { node } of existingProducts) {
      if (!mobimatterHandles.has(node.handle)) {
        const productId = node.id.split("/").pop();
        console.log(`🗑️ Deleting removed product: ${node.title}`);
        await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}.json`, {
          method: "DELETE",
          headers: {
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          },
        });
        removed.push(node.title);
      }
    }

    // ➕ Create new products
    for (const product of products) {
      const handle = `mobimatter-${product.uniqueId}`.toLowerCase();

      const checkQuery = `{
        products(first: 1, query: "handle:${handle}") {
          edges { node { id title } }
        }
      }`;

      const checkRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
        },
        body: JSON.stringify({ query: checkQuery }),
      });

      const checkJson = await checkRes.json();
      const exists = checkJson?.data?.products?.edges?.length > 0;
      if (exists) {
        const title = getProductDetails(product).PLAN_TITLE || product.productFamilyName;
        console.log(`⏭️ Skipped: ${title}`);
        skipped.push(title);
        continue;
      }

      const details = getProductDetails(product);
      const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
      const countryNames = (product.countries || []).map(getCountryDisplay);
      const countriesText = countryNames.join(", ");

      const metafields = [
        { namespace: "esim", key: "fiveg", type: "single_line_text_field", value: details.FIVEG === "1" ? "📶 5G" : "📱 4G" },
        { namespace: "esim", key: "countries", type: "single_line_text_field", value: countriesText },
        { namespace: "esim", key: "topup", type: "single_line_text_field", value: details.TOPUP === "1" ? "Available" : "Not Available" },
        { namespace: "esim", key: "validity", type: "single_line_text_field", value: details.PLAN_VALIDITY || "?" },
        { namespace: "esim", key: "data_limit", type: "single_line_text_field", value: `${details.PLAN_DATA_LIMIT || ""} ${details.PLAN_DATA_UNIT || "GB"}`.trim() },
        { namespace: "esim", key: "calls", type: "single_line_text_field", value: details.HAS_CALLS === "1" ? (details.CALL_MINUTES ? `${details.CALL_MINUTES} minutes` : "Available") : "Not available" },
        { namespace: "esim", key: "sms", type: "single_line_text_field", value: details.HAS_SMS === "1" ? (details.SMS_COUNT ? `${details.SMS_COUNT} SMS` : "Available") : "Not available" },
        { namespace: "esim", key: "provider_logo", type: "single_line_text_field", value: product.providerLogo || "" },
      ];

      const countryTags = (product.countries || [])
        .map((c) => new Intl.DisplayNames(['en'], { type: 'region' }).of(c.toUpperCase()))
        .filter(Boolean);

      const input = {
        title,
        handle,
        descriptionHtml: buildDescription(product, details),
        vendor: product.providerName || "Mobimatter",
        productType: "eSIM",
        tags: countryTags,
        published: true,
        metafields,
      };

      const mutation = `
        mutation productCreate($input: ProductInput!) {
          productCreate(input: $input) {
            product { id title }
            userErrors { field message }
          }
        }
      `;

      const res = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
        },
        body: JSON.stringify({ query: mutation, variables: { input } }),
      });

      const json = await res.json();
      const shopifyId = json?.data?.productCreate?.product?.id;
      if (shopifyId) {
        created.push(title);
        console.log(`✅ Created: ${title}`);
      } else {
        console.error(`❌ Failed to create: ${title}`, json?.data?.productCreate?.userErrors);
        failed.push(title);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ created, skipped, removed, failed }),
    };
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
