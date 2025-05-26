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
      console.error("\u26A0\uFE0F PLAN_DETAILS parse error", err.message);
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
    .replace(/(<(br|p|div)[^>]*>\s*<\/(br|p|div)>|\s|<br\s*\/?\>)+$/gi, '')
    .replace(/\s+$/, '')
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

  const slugify = str =>
    str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  try {
    console.log("\ud83d\udcf1 Fetching from Mobimatter API...");
    const response = await fetch(MOBIMATTER_API_URL, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    const data = await response.json();
    const products = data?.result;

    if (!Array.isArray(products)) throw new Error("Invalid product array");

    for (const product of products.slice(0, 20)) {
      const details = getProductDetails(product);
      const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
      const handle = `${slugify(title)}-${product.uniqueId.slice(0, 6)}`;

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
        console.log(`\u23ED\ufe0f Skipped (already exists): ${title}`);
        skipped.push(title);
        continue;
      }

      if (!product.retailPrice || product.retailPrice <= 0) {
        console.warn(`\u26a0\ufe0f Skipping product due to invalid price: ${title}`);
        failed.push(`${title} (Invalid Price)`);
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
        { namespace: "esim", key: "fiveg", type: "single_line_text_field", value: details.FIVEG === "1" ? "\ud83d\udcf6 5G" : "\ud83d\udcf1 4G" },
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
        console.error(`\u274c Failed to create: ${title}`);
        if (json?.data?.productCreate?.userErrors?.length) {
          json.data.productCreate.userErrors.forEach(err => {
            console.error(`   \ud83d\udd38 Error: ${err.field} - ${err.message}`);
          });
        }
        failed.push(title);
        continue;
      }

      const numericId = productId.split("/").pop();

      let imageUploaded = false;

      if (product.providerLogo?.startsWith("http")) {
        await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${numericId}/images.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          },
          body: JSON.stringify({ image: { src: product.providerLogo } }),
        });
        imageUploaded = true;
        console.log(`\ud83d\uddbc\ufe0f Provider logo uploaded for: ${title}`);
      } else if (product.productImages?.[0]?.startsWith("http")) {
        await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${numericId}/images.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          },
          body: JSON.stringify({ image: { src: product.productImages[0] } }),
        });
        imageUploaded = true;
        console.log(`\ud83d\uddbc\ufe0f Product image uploaded for: ${title}`);
      }

      if (!imageUploaded) {
        console.warn(`\u26a0\ufe0f No image available for: ${title}`);
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
              price: (product.retailPrice).toFixed(2),
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
          console.log(`\ud83d\ude9e Inventory set at location ${locationId} for: ${title}`);
        }
      }

      created.push(title);
      console.log(`\u2705 Created: ${title}`);
    }

    console.log("\u2705 Sync complete.");
    console.log(`\u2795 Created: ${created.length}`);
    console.log(`\u23ED\ufe0f Skipped: ${skipped.length}`);
    console.log(`\u274c Failed: ${failed.length}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ created, skipped, failed }),
    };
  } catch (err) {
    console.error("\u274c Fatal error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
