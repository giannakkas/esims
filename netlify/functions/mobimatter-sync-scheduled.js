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

exports.handler = async (event) => {
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

  const MOBIMATTER_API_URL = "https://api.mobimatter.com/mobimatter/api/v2/products";
  const created = [], updated = [], removed = [], failed = [];

  try {
    // Fetch from Mobimatter
    const response = await fetch(MOBIMATTER_API_URL, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    const data = await response.json();
    const products = (data?.result || []).slice(0, 5);
    const mobimatterHandles = new Set(products.map(p => `mobimatter-${p.uniqueId}`.toLowerCase()));

    // Fetch Shopify products created by this integration
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

    const shopifyData = await shopifyRes.json();
    const existingProducts = shopifyData?.data?.products?.edges || [];

    // Delete products that are no longer in Mobimatter
    for (const { node } of existingProducts) {
      if (!mobimatterHandles.has(node.handle)) {
        await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${node.id.split("/").pop()}.json`, {
          method: "DELETE",
          headers: {
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          },
        });
        removed.push(node.handle);
        console.log(`🗑️ Removed: ${node.handle}`);
      }
    }

    // Create or update products
    for (const product of products) {
      const handle = `mobimatter-${product.uniqueId}`.toLowerCase();
      const details = getProductDetails(product);
      const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
      const countryTags = (product.countries || []).map(code =>
        new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase())
      );

      const descriptionHtml = `
        <h3>${title}</h3>
        <p><strong>Countries:</strong> ${countryTags.join(", ")}</p>
        <p><strong>Data:</strong> ${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}</p>
        <p><strong>Validity:</strong> ${details.PLAN_VALIDITY || "?"}</p>
        <p><strong>Network:</strong> ${details.FIVEG === "1" ? "5G" : "4G"}</p>
      `;

      const existing = existingProducts.find(p => p.node.handle === handle);
      const input = {
        title,
        handle,
        descriptionHtml,
        vendor: product.providerName || "Mobimatter",
        productType: "eSIM",
        tags: countryTags,
        published: true
      };

      const mutation = existing
        ? `
          mutation update($input: ProductInput!) {
            productUpdate(input: $input) {
              product { id title }
              userErrors { field message }
            }
          }
        `
        : `
          mutation create($input: ProductInput!) {
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
        body: JSON.stringify({
          query: mutation,
          variables: { input: existing ? { ...input, id: existing.node.id } : input }
        }),
      });

      const json = await res.json();
      const success = json?.data?.[existing ? "productUpdate" : "productCreate"]?.product?.id;
      if (success) {
        if (existing) {
          updated.push(title);
          console.log(`🔁 Updated: ${title}`);
        } else {
          created.push(title);
          console.log(`✅ Created: ${title}`);
        }
      } else {
        console.error(`❌ Failed to ${existing ? "update" : "create"}: ${title}`, json);
        failed.push(title);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ created, updated, removed, failed }),
    };
  } catch (err) {
    console.error("❌ Error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
