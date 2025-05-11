const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const getProductDetails = (product) => {
  const details = {};
  (product.productDetails || []).forEach(({ name, value }) => {
    details[name.trim()] = value;
  });
  return details;
};

const getCountryWithFlag = (code) => {
  if (!code || code.length !== 2) return code;
  const flag = code
    .toUpperCase()
    .replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt()));
  const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase());
  return `${flag} ${name}`;
};

const buildDescription = (details) => {
  let planDetailsHtml = "";
  let additionalHtml = "";

  if (details["PLAN_DETAILS"]) {
    try {
      const parsed = JSON.parse(details["PLAN_DETAILS"]);
      const heading = parsed.heading ? `<h3>${parsed.heading}</h3>` : "";
      const description = parsed.description ? `<p>${parsed.description}</p>` : "";
      const items = parsed.items?.length
        ? `<ul>${parsed.items.map(item => `<li>${item}</li>`).join("")}</ul>`
        : "";
      planDetailsHtml = `<div class="plan-details">${heading}${description}${items}</div>`;
    } catch (err) {
      console.error("⚠️ PLAN_DETAILS parse error", err.message);
    }
  }

  if (details["ADDITIONAL_DETAILS"]) {
    additionalHtml = `
      <div class="additional-details">
        <h4>Additional Info</h4>
        <p>${details["ADDITIONAL_DETAILS"]
          .replace(/\n/g, "<br>")
          .replace(/\s+/g, " ")
          .trim()}</p>
      </div>`;
  }

  return (`${planDetailsHtml}${additionalHtml}`)
    .replace(/(<(br|p|div)[^>]*>\s*<\/(br|p|div)>|\s|<br\s*\/?>)+$/gi, '')
    .replace(/\s+$/, '')
    .trim();
};

// Remove brute-force fetch, use a single fetch as per Mobimatter API docs
async function fetchMobimatterProducts(apiUrl, headers) {
  const response = await fetch(apiUrl, { headers });
  const data = await response.json();
  return data?.result || [];
}

// Fetch all Shopify products with mobimatter- handle prefix
async function fetchAllShopifyProducts(storeDomain, apiVersion, adminApiKey) {
  let products = [];
  let hasNextPage = true;
  let endCursor = null;
  while (hasNextPage) {
    const query = `{
      products(first: 100, query: \"handle:mobimatter-\"${endCursor ? `, after: \"${endCursor}\"` : ''}) {
        edges { node { id handle title } cursor }
        pageInfo { hasNextPage }
      }
    }`;
    const res = await fetch(`https://${storeDomain}/admin/api/${apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminApiKey,
      },
      body: JSON.stringify({ query }),
    });
    const json = await res.json();
    const edges = json?.data?.products?.edges || [];
    products = products.concat(edges.map(e => e.node));
    hasNextPage = json?.data?.products?.pageInfo?.hasNextPage;
    endCursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
    if (!hasNextPage) break;
  }
  return products;
}

exports.handler = async () => {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2025-04",
  } = process.env;

  const MOBIMATTER_API_URL = "https://api.mobimatter.com/mobimatter/api/v2/products";
  const mobimatterHeaders = {
    "api-key": MOBIMATTER_API_KEY,
    merchantId: MOBIMATTER_MERCHANT_ID,
    Accept: "text/plain"
  };

  const logs = [];
  const created = [], updated = [], deleted = [], skipped = [], failed = [];

  try {
    logs.push("📡 Fetching products from Mobimatter API...");
    const mobimatterProducts = await fetchMobimatterProducts(MOBIMATTER_API_URL, mobimatterHeaders);
    logs.push(`Fetched ${mobimatterProducts.length} products from Mobimatter.`);
    const mobimatterMap = new Map(mobimatterProducts.map(p => [(`mobimatter-${p.uniqueId}`).toLowerCase(), p]));

    logs.push("📡 Fetching all Mobimatter products from Shopify...");
    const shopifyProducts = await fetchAllShopifyProducts(SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION, SHOPIFY_ADMIN_API_KEY);
    logs.push(`Fetched ${shopifyProducts.length} Mobimatter products from Shopify.`);
    const shopifyMap = new Map(shopifyProducts.map(p => [p.handle, p]));

    // 1. Delete products in Shopify not in Mobimatter
    for (const [handle, shopifyProduct] of shopifyMap.entries()) {
      if (!mobimatterMap.has(handle)) {
        // Delete product
        const productId = shopifyProduct.id;
        const res = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${productId.split("/").pop()}.json`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          },
        });
        if (res.ok) {
          logs.push(`🗑️ Deleted: ${shopifyProduct.title} (${handle})`);
          deleted.push({ handle, title: shopifyProduct.title });
        } else {
          logs.push(`❌ Failed to delete: ${shopifyProduct.title} (${handle})`);
          failed.push({ handle, title: shopifyProduct.title, error: 'Delete failed' });
        }
      }
    }

    // 2. Add or update products from Mobimatter
    for (const [handle, mobimatterProduct] of mobimatterMap.entries()) {
      const details = getProductDetails(mobimatterProduct);
      const title = details.PLAN_TITLE || mobimatterProduct.productFamilyName || "Unnamed eSIM";
      const shopifyProduct = shopifyMap.get(handle);
      let action = '';
      let error = null;
      try {
        // Prepare product input
        const countryNamesWithFlags = (mobimatterProduct.countries || [])
          .map(getCountryWithFlag)
          .filter(Boolean);
        const rawValidity = details.PLAN_VALIDITY || "";
        const validityInDays = /^\d+$/.test(rawValidity)
          ? `${parseInt(rawValidity) / 24} days`
          : rawValidity;
        const metafields = [
          { namespace: "esim", key: "fiveg", type: "single_line_text_field", value: details.FIVEG === "1" ? "📶 5G" : "📱 4G" },
          { namespace: "esim", key: "countries", type: "single_line_text_field", value: countryNamesWithFlags.join(", ") },
          { namespace: "esim", key: "topup", type: "single_line_text_field", value: details.TOPUP === "1" ? "Available" : "Not Available" },
          { namespace: "esim", key: "validity", type: "single_line_text_field", value: validityInDays },
          { namespace: "esim", key: "data_limit", type: "single_line_text_field", value: `${details.PLAN_DATA_LIMIT || ""} ${details.PLAN_DATA_UNIT || "GB"}`.trim() },
          { namespace: "esim", key: "calls", type: "single_line_text_field", value: details.HAS_CALLS === "1" ? (details.CALL_MINUTES ? `${details.CALL_MINUTES} minutes` : "Available") : "Not available" },
          { namespace: "esim", key: "sms", type: "single_line_text_field", value: details.HAS_SMS === "1" ? (details.SMS_COUNT ? `${details.SMS_COUNT} SMS` : "Available") : "Not available" },
          { namespace: "esim", key: "provider_logo", type: "single_line_text_field", value: mobimatterProduct.providerLogo || "" }
        ];
        const input = {
          title,
          handle,
          descriptionHtml: buildDescription(details),
          vendor: mobimatterProduct.providerName || "Mobimatter",
          productType: "eSIM",
          tags: countryNamesWithFlags,
          published: true,
          metafields,
        };
        if (!shopifyProduct) {
          // Create product
          const mutation = `
            mutation productCreate($input: ProductInput!) {
              productCreate(input: $input) {
                product { id title handle }
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
          const productId = json?.data?.productCreate?.product?.id;
          if (!productId) {
            action = 'failed';
            error = json?.data?.productCreate?.userErrors || 'Unknown error';
            failed.push({ handle, title, error });
            logs.push(`❌ Failed to create: ${title} (${handle}) - ${JSON.stringify(error)}`);
          } else {
            action = 'created';
            created.push({ handle, title });
            logs.push(`✅ Created: ${title} (${handle})`);
          }
        } else {
          // Update product (for simplicity, always update)
          const mutation = `
            mutation productUpdate($input: ProductInput!) {
              productUpdate(input: $input) {
                product { id title handle }
                userErrors { field message }
              }
            }
          `;
          input.id = shopifyProduct.id;
          const res = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
            },
            body: JSON.stringify({ query: mutation, variables: { input } }),
          });
          const json = await res.json();
          const productId = json?.data?.productUpdate?.product?.id;
          if (!productId) {
            action = 'failed';
            error = json?.data?.productUpdate?.userErrors || 'Unknown error';
            failed.push({ handle, title, error });
            logs.push(`❌ Failed to update: ${title} (${handle}) - ${JSON.stringify(error)}`);
          } else {
            action = 'updated';
            updated.push({ handle, title });
            logs.push(`🔄 Updated: ${title} (${handle})`);
          }
        }
      } catch (err) {
        failed.push({ handle, title, error: err.message });
        logs.push(`❌ Error processing: ${title} (${handle}) - ${err.message}`);
      }
    }

    logs.push("✅ Sync complete.");
    logs.push(`➕ Created: ${created.length}`);
    logs.push(`🔄 Updated: ${updated.length}`);
    logs.push(`🗑️ Deleted: ${deleted.length}`);
    logs.push(`⏭️ Skipped: ${skipped.length}`);
    logs.push(`❌ Failed: ${failed.length}`);

    // Print logs to Netlify dashboard
    logs.forEach(line => console.log(line));

    return {
      statusCode: 200,
      body: JSON.stringify({
        created,
        updated,
        deleted,
        skipped,
        failed,
        logs,
        summary: {
          total: created.length + updated.length + deleted.length + skipped.length + failed.length,
          created: created.length,
          updated: updated.length,
          deleted: deleted.length,
          skipped: skipped.length,
          failed: failed.length
        }
      }),
    };
  } catch (err) {
    logs.push(`❌ Fatal error: ${err.message}`);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message, logs }),
    };
  }
};
