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

// Helper to fetch all products from Mobimatter with pagination
async function fetchAllMobimatterProducts(apiUrl, headers) {
  let allProducts = [];
  let page = 1;
  const pageSize = 100; // Adjust if Mobimatter allows a higher limit
  let hasMore = true;

  while (hasMore) {
    const url = `${apiUrl}?page=${page}&pageSize=${pageSize}`;
    const response = await fetch(url, { headers });
    const data = await response.json();
    const products = data?.result || [];
    allProducts = allProducts.concat(products);
    // If less than pageSize returned, we're done
    hasMore = products.length === pageSize;
    page++;
  }
  return allProducts;
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
  const created = [], skipped = [], failed = [], detailed = [];

  try {
    console.log("📡 Fetching all products from Mobimatter API (with pagination)...");
    const mobimatterHeaders = {
      "api-key": MOBIMATTER_API_KEY,
      merchantId: MOBIMATTER_MERCHANT_ID,
    };
    const products = await fetchAllMobimatterProducts(MOBIMATTER_API_URL, mobimatterHeaders);
    console.log(`Fetched ${products.length} products from Mobimatter.`);

    if (!Array.isArray(products)) throw new Error("Invalid product array");

    for (const product of products) {
      const handle = `mobimatter-${product.uniqueId}`.toLowerCase();
      const details = getProductDetails(product);
      const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
      let productReport = { handle, title, status: '', error: null };

      try {
        // Check if product exists in Shopify
        const checkQuery = `{
          products(first: 1, query: \"handle:${handle}\") {
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
          productReport.status = 'skipped';
          skipped.push(title);
          detailed.push(productReport);
          continue;
        }

        const countryNamesWithFlags = (product.countries || [])
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
          { namespace: "esim", key: "provider_logo", type: "single_line_text_field", value: product.providerLogo || "" }
        ];
        const input = {
          title,
          handle,
          descriptionHtml: buildDescription(details),
          vendor: product.providerName || "Mobimatter",
          productType: "eSIM",
          tags: countryNamesWithFlags,
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
        const productId = json?.data?.productCreate?.product?.id;
        if (!productId) {
          productReport.status = 'failed';
          productReport.error = json?.data?.productCreate?.userErrors || 'Unknown error';
          failed.push(title);
          detailed.push(productReport);
          continue;
        }
        const numericId = productId.split("/").pop();
        if (product.providerLogo?.startsWith("http")) {
          await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${numericId}/images.json`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
            },
            body: JSON.stringify({ image: { src: product.providerLogo } }),
          });
        }
        const variantRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${numericId}/variants.json`, {
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          },
        });
        const { variants } = await variantRes.json();
        const variantId = variants?.[0]?.id;
        const inventoryItemId = variants?.[0]?.inventory_item_id;
        if (variantId && inventoryItemId) {
          await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/variants/${variantId}.json`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
            },
            body: JSON.stringify({
              variant: {
                id: variantId,
                price: (product.retailPrice || 0).toFixed(2),
                sku: product.uniqueId,
                inventory_management: "shopify",
                inventory_policy: "continue"
              },
            }),
          });
          const locationsRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/locations.json`, {
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
            },
          });
          const locations = (await locationsRes.json()).locations;
          const locationId = locations?.[0]?.id;
          if (locationId) {
            await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/set.json`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
              },
              body: JSON.stringify({
                location_id: locationId,
                inventory_item_id: inventoryItemId,
                available: 999999,
              }),
            });
          }
        }
        created.push(title);
        productReport.status = 'created';
        detailed.push(productReport);
      } catch (err) {
        productReport.status = 'failed';
        productReport.error = err.message;
        failed.push(title);
        detailed.push(productReport);
      }
    }

    console.log("✅ Sync complete.");
    console.log(`➕ Created: ${created.length}`);
    console.log(`⏭️ Skipped: ${skipped.length}`);
    console.log(`❌ Failed: ${failed.length}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        created,
        skipped,
        failed,
        detailed,
        summary: {
          total: detailed.length,
          created: created.length,
          skipped: skipped.length,
          failed: failed.length
        }
      }),
    };
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
