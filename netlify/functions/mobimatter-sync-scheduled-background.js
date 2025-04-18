const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

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

// TEMP: DEBUG VERSION — log all possible description fields
const buildDescription = (product, details) => {
  console.log("🧪 RAW PRODUCT:", JSON.stringify(product, null, 2));

  return `
    <div class="esim-description">
      <h3>${details.PLAN_TITLE || product.productFamilyName || "eSIM Plan"} (Debug)</h3>
      <p><strong>description:</strong><br>${product.description || "N/A"}</p>
      <p><strong>longDescription:</strong><br>${product.longDescription || "N/A"}</p>
      <p><strong>Other JSON (truncated):</strong></p>
      <pre>${JSON.stringify(product, null, 2).substring(0, 3000)}...</pre>
    </div>
  `;
};

exports.handler = async () => {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2025-04",
  } = process.env;

  const MOBIMATTER_API_URL = "https://api.mobimatter.com/mobimatter/api/v2/products";
  const created = [], skipped = [], failed = [];

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
    const products = data?.result;

    if (!Array.isArray(products)) throw new Error("Invalid product array from Mobimatter");

    for (const product of products.slice(0, 1)) {
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
        const details = getProductDetails(product);
        const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
        console.log(`⏭️ Skipped: ${title}`);
        skipped.push(title);
        continue;
      }

      const details = getProductDetails(product);
      const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";

      const input = {
        title,
        handle,
        descriptionHtml: buildDescription(product, details),
        vendor: product.providerName || "Mobimatter",
        productType: "eSIM",
        tags: [],
        published: true,
        metafields: [],
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
        console.log(`✅ Created (Debug Mode): ${title}`);
      } else {
        console.error(`❌ Failed to create: ${title}`, json?.data?.productCreate?.userErrors);
        failed.push(title);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ created, skipped, failed }),
    };
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
