const fetch = require("node-fetch");

// Example of flag URLs for countries (you can get a larger mapping)
const countryFlags = {
  "VN": "https://flagcdn.com/w320/vn.png",
  "US": "https://flagcdn.com/w320/us.png",
  "FR": "https://flagcdn.com/w320/fr.png",
  "DE": "https://flagcdn.com/w320/de.png",
  // Add other countries as needed
};

exports.handler = async function () {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2025-01",
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

    for (const product of products.slice(0, 100)) { // limit to 100 for testing
      const details = {};
      (product.productDetails || []).forEach(({ name, value }) => {
        details[name.trim()] = value;
      });

      const has5G = details.FIVEG === "1" ? "5G" : "4G";
      const speed = details.SPEED || "Unknown";
      const topUp = details.TOPUP === "1" ? "Available" : "Not available";
      const countries = (product.countries || [])
        .map(countryCode => {
          const flagUrl = countryFlags[countryCode] || ""; // Get the flag URL
          const countryName = countryCode; // You can replace this with a map for country names
          return flagUrl ? `<img src="${flagUrl}" alt="${countryName}" style="width: 20px; margin-right: 5px;"> ${countryName}` : countryName;
        })
        .join(", ");
      const dataAmount = `${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}`;
      const validity = details.PLAN_VALIDITY || "?";

      const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
      const price = product.retailPrice?.toFixed(2);
      if (!title || !price) {
        failed.push({ title: title || "(missing)", reason: "Missing title or price" });
        continue;
      }

      const body_html = `
        <p><strong>Network:</strong> ${has5G}</p>
        <p><strong>Speed:</strong> ${speed}</p>
        <p><strong>Top-up:</strong> ${topUp}</p>
        <p><strong>Countries:</strong> ${countries}</p>
        <p><strong>Data:</strong> ${dataAmount}</p>
        <p><strong>Validity:</strong> ${validity} days</p>
      `;

      const productPayload = {
        product: {
          title,
          body_html,
          vendor: product.providerName || "Mobimatter",
          product_type: "eSIM",
          tags: [has5G, "eSIM"],
          variants: [
            {
              price,
              sku: product.uniqueId,
              inventory_quantity: 999999,
              fulfillment_service: "manual",
              inventory_management: null,
              taxable: true,
            },
          ],
          images: [
            {
              src: product.providerLogo,
            },
          ],
        },
      };

      const shopifyRes = await fetch(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          },
          body: JSON.stringify(productPayload),
        }
      );

      if (!shopifyRes.ok) {
        const errorText = await shopifyRes.text();
        failed.push({ title, reason: errorText, status: shopifyRes.status });
      } else {
        created.push(title);
      }
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
