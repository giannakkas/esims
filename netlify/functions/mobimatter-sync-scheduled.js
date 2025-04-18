const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const getCountryDisplay = (code) => {
  if (!code?.length !== 2) return `🌐 ${code}`;
  const flag = code
    .toUpperCase()
    .replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt()));
  const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase());
  return `${flag} ${name || code}`;
};

const getProductDetails = (product) => {
  const details = {};
  (product.productDetails || []).forEach(({ name, value }) => {
    details[name?.trim()] = value;
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

  console.log("🔐 ENV CHECK:", {
    MOBIMATTER_API_KEY: !!MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID: !!MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY: !!SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
  });

  const created = [], updated = [], removed = [], failed = [];

  try {
    console.log("📡 Fetching Mobimatter products...");
    const mmRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/products", {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    console.log("📡 Mobimatter status:", mmRes.status);
    const raw = await mmRes.text();
    console.log("📦 Mobimatter raw response:", raw.slice(0, 500));

    const data = JSON.parse(raw);
    const products = (data?.result || []).slice(0, 5);
    const mobimatterHandles = new Set(products.map(p => `mobimatter-${p.uniqueId}`.toLowerCase()));

    console.log(`🔄 Processing ${products.length} products from Mobimatter...`);

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
    console.log("🛒 Existing Shopify products:", shopifyJson?.data?.products?.edges?.length);
    const existingProducts = shopifyJson?.data?.products?.edges || [];

    for (const { node } of existingProducts) {
      if (!mobimatterHandles.has(node.handle)) {
        const productId = node.id.split("/").pop();
        console.log(`🗑️ Deleting ${node.title} (${productId})`);
        const delRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}.json`, {
          method: "DELETE",
          headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY },
        });
        console.log(`🗑️ Delete response status: ${delRes.status}`);
        removed.push(node.handle);
      }
    }

    for (const product of products) {
      const handle = `mobimatter-${product.uniqueId}`.toLowerCase();
      const existing = existingProducts.find(p => p.node.handle === handle);
      const details = getProductDetails(product);
      const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
      const countryTags = (product.countries || []).map(code =>
        new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase())
      ).filter(Boolean);

      const descriptionHtml = `
        <h3>${title}</h3>
        <p><strong>Countries:</strong> ${countryTags.join(", ")}</p>
        <p><strong>Data:</strong> ${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}</p>
        <p><strong>Validity:</strong> ${details.PLAN_VALIDITY || "?"}</p>
        <p><strong>Network:</strong> ${details.FIVEG === "1" ? "5G" : "4G"}</p>
      `;

      const input = {
        title,
        handle,
        descriptionHtml,
        vendor: product.providerName || "Mobimatter",
        productType: "eSIM",
        tags: countryTags,
        published: true,
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

      const mutationRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
        },
        body: JSON.stringify({
          query: mutation,
          variables: { input: existing ? { ...input, id: existing.node.id } : input },
        }),
      });

      const mutationJson = await mutationRes.json();
      const success = mutationJson?.data?.[existing ? "productUpdate" : "productCreate"]?.product?.id;

      if (success) {
        if (existing) {
          console.log(`🔁 Updated: ${title}`);
          updated.push(title);
        } else {
          console.log(`✅ Created: ${title}`);
          created.push(title);
        }
      } else {
        console.error(`❌ Failed to ${existing ? "update" : "create"}: ${title}`);
        console.error(JSON.stringify(mutationJson, null, 2));
        failed.push(title);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ created, updated, removed, failed }),
    };
  } catch (err) {
    console.error("❌ Unhandled Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
