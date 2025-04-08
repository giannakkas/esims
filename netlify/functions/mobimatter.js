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

  for (const product of products.slice(0, 10)) {
    const details = {};
    (product.productDetails || []).forEach(({ name, value }) => {
      details[name.trim()] = value;
    });

    const has5G = details.FIVEG === "1" ? "5G" : "4G";
    const speed = details.SPEED || "Unknown";
    const topUp = details.TOPUP === "1" ? "Available" : "Not available";
    const countries = (product.countries || []).map(c => `:flag-${c.toLowerCase()}:`).join(" ");
    const dataAmount = `${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}`;
    const validity = details.PLAN_VALIDITY || "?";
    const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
    const price = product.retailPrice?.toFixed(2);

    if (!title || !price) {
      failed.push({ title: title || "(missing)", reason: "Missing title or price" });
      continue;
    }

    const bodyHtml = `
      <p><strong>Network:</strong> ${has5G}</p>
      <p><strong>Speed:</strong> ${speed}</p>
      <p><strong>Top-up:</strong> ${topUp}</p>
      <p><strong>Countries:</strong> ${countries}</p>
      <p><strong>Data:</strong> ${dataAmount}</p>
      <p><strong>Validity:</strong> ${validity} days</p>
    `;

    const productMutation = `
      mutation productCreate($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            title
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        title,
        descriptionHtml: bodyHtml,
        vendor: product.providerName || "Mobimatter",
        productType: "eSIM",
        tags: [has5G, "eSIM"],
      },
    };

    const shopifyRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
      },
      body: JSON.stringify({ query: productMutation, variables }),
    });

    const result = await shopifyRes.json();

    const productId = result.data?.productCreate?.product?.id;
    if (productId) {
      created.push(title);

      // Upload image
      const mediaMutation = `
        mutation productCreateMedia($media: [CreateMediaInput!]!, $productId: ID!) {
          productCreateMedia(media: $media, productId: $productId) {
            media {
              alt
              mediaContentType
              status
            }
            mediaUserErrors {
              field
              message
            }
          }
        }
      `;

      const mediaVariables = {
        productId,
        media: [
          {
            originalSource: product.providerLogo,
            mediaContentType: "IMAGE",
            alt: product.providerName || "eSIM",
          },
        ],
      };

      await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
        },
        body: JSON.stringify({ query: mediaMutation, variables: mediaVariables }),
      });
    } else {
      const reason = result.errors?.[0]?.message || result.data?.productCreate?.userErrors?.[0]?.message || "Unknown";
      failed.push({ title, reason: `GraphQL Error: ${JSON.stringify(reason)}` });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: `Created ${created.length} product(s)`, created, failed }),
  };
} catch (err) {
  return {
    statusCode: 500,
    body: JSON.stringify({
      error: "Mobimatter fetch or Shopify sync failed",
      message: err.message,
    }),
  };
}
