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

  return `${planDetailsHtml}${additionalHtml}`
    .replace(/(<br\s*\/?>|\s|<p><\/p>)+$/gi, "") // remove trailing whitespace and empty tags
    .trim();
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

    const data = await response.json();
    const products = data?.result;

    if (!Array.isArray(products)) throw new Error("Invalid product array");

    for (const product of products.slice(0, 5)) {
      const handle = `mobimatter-${product.uniqueId}`.toLowerCase();
      const details = getProductDetails(product);
      const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";

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
        console.log(`⏭️ Skipped: ${title}`);
        skipped.push(title);
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
        console.error(`❌ Failed to create: ${title}`, json?.data?.productCreate?.userErrors);
        failed.push(title);
        continue;
      }

      const numericId = productId.split("/").pop();

      // Upload image
      if (product.providerLogo?.startsWith("http")) {
        await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${numericId}/images.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          },
          body: JSON.stringify({ image: { src: product.providerLogo } }),
        });
        console.log(`🖼️ Image uploaded for: ${title}`);
      }

      // Price + stock
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
          console.log(`📦 Inventory set at location ${locationId} for: ${title}`);
        }
      }

      created.push(title);
      console.log(`✅ Created: ${title}`);
    }

    console.log("✅ Sync complete.");
    console.log(`➕ Created: ${created.length}`);
    console.log(`⏭️ Skipped: ${skipped.length}`);
    console.log(`❌ Failed: ${failed.length}`);

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
