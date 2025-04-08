const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Tightened configuration for timeout safety
const CONFIG = {
  MAX_EXECUTION_TIME: 9500,     // Stop at 9.5s to avoid hard timeout
  PRODUCTS_PER_RUN: 3,          // Reduced from 5 to 3 for safety
  MOBIMATTER_TIMEOUT: 1500,     // 1.5s timeout for MobiMatter API
  SHOPIFY_TIMEOUT: 2000,        // 2s timeout for Shopify API
  MOBIMATTER_API_URL: "https://api.mobimatter.com/mobimatter/api/v2/products"
};

// Minimal GraphQL mutations
const SHOPIFY_MUTATION = `...`; // Your existing mutation
const SHOPIFY_IMAGE_MUTATION = `...`; // Your existing image mutation

exports.handler = async (event) => {
  const startTime = Date.now();
  const getRemainingTime = () => CONFIG.MAX_EXECUTION_TIME - (Date.now() - startTime);
  
  const results = {
    processed: 0,
    created: [],
    errors: [],
    skipped: true // Default to true in case we don't complete
  };

  try {
    // 1. Quick health check
    if (getRemainingTime() < 2000) {
      throw new Error("Insufficient time remaining at start");
    }

    // 2. Fetch products with tight timeout
    const mobiResponse = await fetch(CONFIG.MOBIMATTER_API_URL, {
      headers: {
        "api-key": process.env.MOBIMATTER_API_KEY,
        "merchantId": process.env.MOBIMATTER_MERCHANT_ID,
        "Ocp-Apim-Subscription-Key": process.env.MOBIMATTER_SUBSCRIPTION_KEY
      },
      timeout: CONFIG.MOBIMATTER_TIMEOUT
    });

    if (!mobiResponse.ok) throw new Error(`MobiMatter API: ${mobiResponse.status}`);
    const { result: products } = await mobiResponse.json();

    // 3. Process products with aggressive time checking
    for (const product of products.slice(0, CONFIG.PRODUCTS_PER_RUN)) {
      if (getRemainingTime() < 1500) {
        results.skipped = true;
        break;
      }

      try {
        // Simplified product creation (no image upload in initial pass)
        const createResponse = await fetch(
          `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-04'}/graphql.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_KEY,
            },
            body: JSON.stringify({
              query: SHOPIFY_MUTATION,
              variables: { 
                input: {
                  title: product.productFamilyName || "Unnamed eSIM",
                  productType: "eSIM",
                  status: "ACTIVE"
                }
              }
            }),
            timeout: CONFIG.SHOPIFY_TIMEOUT
          }
        );

        results.created.push(product.productFamilyName);
        results.processed++;
        results.skipped = false;
      } catch (err) {
        results.errors.push({
          product: product.productFamilyName,
          error: err.message.substring(0, 100) // Truncate long errors
        });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        executionTime: `${((Date.now() - startTime)/1000).toFixed(2)}s`,
        stats: {
          totalProducts: products.length,
          processed: results.processed,
          created: results.created.length,
          errors: results.errors.length
        },
        nextSteps: results.skipped ? "Run again to continue processing" : null
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Processing incomplete",
        message: err.message,
        executionTime: `${((Date.now() - startTime)/1000).toFixed(2)}s`,
        lastState: results
      })
    };
  }
};
