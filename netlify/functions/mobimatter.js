if (!response.ok) {
  throw new Error(`Mobimatter fetch failed: ${response.status}`);
}

const { result: products } = await response.json();
const created = [], updated = [], failed = [];

for (const product of products) {
  const details = {};
  (product.productDetails || []).forEach(({ name, value }) => {
    details[name.trim()] = value;
  });

  const has5G = details.FIVEG === "1" ? "5G" : "4G";
  const speed = details.SPEED || "Unknown";
  const topUp = details.TOPUP === "1" ? "Available" : "Not available";
  const hotspot = details.HOTSPOT === "1" ? "Yes" : "No";
  const unlimited = details.UNLIMITED === "1" ? "Yes" : "No";
  const realtime = product.productCategory?.toLowerCase().includes("realtime") ? "Realtime" : "Delayed";
  const countriesArray = product.countries || [];
  const countries = countriesArray.map(code => `${countryCodeToFlag(code)} ${code}`).join(", ");
  const regionTags = product.regions || [];

  const dataAmount = `${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}`;
  const validity = details.PLAN_VALIDITY || "?";
  const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
  const price = product.retailPrice?.toFixed(2);

  if (!title || !price) {
    failed.push({ title: title || "(missing)", reason: "Missing title or price" });
    continue;
  }

  const description = `
    <p><strong>Data:</strong> ${dataAmount}</p>
    <p><strong>Validity:</strong> ${validity} days</p>
    <p><strong>Speed:</strong> ${speed}</p>
    <p><strong>Network:</strong> ${has5G}</p>
    <p><strong>Top-up:</strong> ${topUp}</p>
    <p><strong>Hotspot:</strong> ${hotspot}</p>
    <p><strong>Unlimited:</strong> ${unlimited}</p>
    <p><strong>Activation:</strong> ${realtime}</p>
    <p><strong>Countries:</strong> ${countries}</p>
  `;

  const tags = [
    has5G,
    "eSIM",
    ...regionTags,
    hotspot === "Yes" ? "Hotspot" : "",
    unlimited === "Yes" ? "Unlimited" : "",
    realtime,
    ...countriesArray.slice(0, 5), // ISO codes only, useful for filters
  ].filter(Boolean);

  const productPayload = {
    product: {
      title,
      body_html: description,
      vendor: product.providerName || "Mobimatter",
      product_type: "eSIM",
      tags,
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

  // 🔁 Check if the product already exists by SKU
  const existing = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json?fields=id,title,variants&limit=250`, {
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
    },
  });

  const existingData = await existing.json();
  const match = (existingData.products || []).find(p =>
    p.variants.some(v => v.sku === product.uniqueId)
  );

  const endpoint = match
    ? `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${match.id}.json`
    : `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json`;

  const method = match ? "PUT" : "POST";

  const shopifyRes = await fetch(endpoint, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
    },
    body: JSON.stringify(productPayload),
  });

  if (!shopifyRes.ok) {
    const errorText = await shopifyRes.text();
    failed.push({ title, reason: errorText, status: shopifyRes.status });
  } else {
    match ? updated.push(title) : created.push(title);
  }
}

return {
  statusCode: 200,
  body: JSON.stringify({
    message: `Created ${created.length}, Updated ${updated.length} product(s)`,
    created,
    updated,
    failed,
  }),
};
