// Use dynamic import for node-fetch (ESM compatibility)
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Configuration
const CONFIG = {
  BATCH_SIZE: 10,               // Products to process per execution
  MAX_PRODUCTS: 100,            // Absolute limit for safety
  MOBIMATTER_API_URL: "https://api.mobimatter.com/mobimatter/api/v2/products",
  SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || "2025-04"
};

// Shopify GraphQL Mutation
const SHOPIFY_MUTATION = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        title
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Transform MobiMatter product to Shopify format
const transformProduct = (product) => {
  const details = {};
  (product.productDetails || []).forEach(({ name, value }) => {
    details[name.trim()] = value;
  });

  const has5G = details.FIVEG === "1" ? "5G" : "4G";
  const speed = details.SPEED || "Unknown";
  const topUp = details.TOPUP === "1" ? "Available" : "Not available";
  const countries = (product.countries || [])
    .map(c => `:flag-${c.toLowerCase()}:`)
    .join(" ");
  const dataAmount = `${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}`;
  const validity = details.PLAN_VALIDITY || "?";
  const vendor = product.providerName || "Mobimatter";
  const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
  const price = product.retailPrice?.toFixed(2);

  return {
    title,
    descriptionHtml: `
      <p><strong>Network:</strong> ${has5G}</p>
      <p><strong>Speed:</strong> ${speed}</p>
      <p><strong>Top-up:</strong> ${topUp}</p>
      <p><strong>Countries:</strong> ${countries}</p>
      <p><strong>Data:</strong> ${dataAmount}</p>
      <p><strong>Validity:</strong> ${validity} days</p>
      <p><strong>Price:</strong> $${price}</p>
    `,
    vendor,
    productType: "eSIM",
    tags: [has5G, "eSIM", `data-${dataAmount}`],
    status: "ACTIVE",
    images: product.providerLogo ? [{ src: product.providerLogo }] : undefined
  };
};

// Main handler
exports.handler = async () => {
  const results = {
    processed: 0,
    created: [],
    skipped: [],
    errors: []
  };

  try {
    // 1. Fetch products from MobiMatter
    const response = await fetch(CONFIG.MOBIMATTER_API_URL, {
      headers: {
        "api-key": process.env.MOBIMATTER_API_KEY,
        "merchantId": process.env.MOBIMATTER_MERCHANT_ID,
        "Ocp-Apim-Subscription-Key": process.env.MOBIMATTER_SUBSCRIPTION_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`MobiMatter API failed: ${response.status}`);
    }

    const { result: products } = await response.json();

    // 2. Process products in batches
    for (const product of products.slice(0, CONFIG.MAX_PRODUCTS)) {
      if (results.created.length >= CONFIG.BATCH_SIZE) {
        results.skipped.push(product.productFamilyName || "Unnamed Product");
        continue;
      }

      try {
        const productData = transformProduct(product);
        
        if (!productData.title || !productData.descriptionHtml) {
          throw new Error("Invalid product data");
        }

        // 3. Create Shopify product
        const shopifyResponse = await fetch(
          `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${CONFIG.SHOPIFY_API_VERSION}/graphql.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_KEY,
            },
            body: JSON.stringify({
              query: SHOPIFY_MUTATION,
              variables: { input: productData }
            })
          }
        );

        const responseData = await shopifyResponse.json();
        
        if (responseData.errors || responseData.data?.productCreate?.userErrors?.length) {
          throw new Error(
            responseData.errors?.[0]?.message || 
            responseData.data?.productCreate?.userErrors?.[0]?.message ||
            "Unknown Shopify error"
          );
        }

        results.created.push(productData.title);
      } catch (err) {
        results.errors.push({
          product: product.productFamilyName || "Unnamed Product",
          error: err.message
        });
      }
      
      results.processed++;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        stats: {
          totalProducts: products.length,
          processed: results.processed,
          created: results.created.length,
          skipped: results.skipped.length,
          errors: results.errors.length
        },
        details: {
          created: results.created,
          errors: results.errors
        },
        nextBatch: results.skipped.length > 0 
          ? { remaining: products.length - results.processed }
          : null
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: "Processing failed",
        message: err.message,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
        failedBatch: results
      })
    };
  }
};
