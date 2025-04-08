// Use dynamic import for ESM compatibility
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Configuration - Adjust these based on your needs
const CONFIG = {
  SAFETY_TIMEOUT: 9000,         // Stop 1s before Netlify's 10s timeout (in ms)
  PRODUCTS_PER_RUN: 5,          // Start small, increase gradually
  MOBIMATTER_API_URL: "https://api.mobimatter.com/mobimatter/api/v2/products",
  SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || "2025-04",
  SHOPIFY_TIMEOUT: 3000         // 3s timeout per Shopify request
};

// Minimal GraphQL mutation for Shopify
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

  return {
    title: details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM",
    descriptionHtml: `
      <div class="esim-description">
        <p><strong>Data:</strong> ${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}</p>
        <p><strong>Validity:</strong> ${details.PLAN_VALIDITY || "?"} days</p>
        ${details.FIVEG === "1" ? '<p><strong>Technology:</strong> 5G</p>' : ''}
      </div>
    `,
    productType: "eSIM",
    status: "ACTIVE",
    vendor: product.providerName || "Mobimatter",
    tags: [
      details.FIVEG === "1" ? "5G" : "4G",
      "eSIM",
      `data-${details.PLAN_DATA_LIMIT || 'unknown'}${details.PLAN_DATA_UNIT || 'GB'}`
    ],
    ...(product.providerLogo && { 
      images: [{ src: product.providerLogo }] 
    })
  };
};

exports.handler = async (event) => {
  const startTime = Date.now();
  const results = {
    processed: 0,
    created: [],
    errors: [],
    skipped: false
  };

  try {
    // Calculate remaining time
    const getRemainingTime = () => CONFIG.SAFETY_TIMEOUT - (Date.now() - startTime);

    // 1. Fetch products with pagination
    const offset = event.queryStringParameters?.offset || 0;
    const apiUrl = `${CONFIG.MOBIMATTER_API_URL}?limit=${CONFIG.PRODUCTS_PER_RUN}&offset=${offset}`;
    
    if (getRemainingTime() < 2000) {
      throw new Error("Insufficient time remaining for API call");
    }

    const mobiResponse = await fetch(apiUrl, {
      headers: {
        "api-key": process.env.MOBIMATTER_API_KEY,
        "merchantId": process.env.MOBIMATTER_MERCHANT_ID,
        "Ocp-Apim-Subscription-Key": process.env.MOBIMATTER_SUBSCRIPTION_KEY
      },
      timeout: 2000 // 2s timeout for MobiMatter API
    });

    if (!mobiResponse.ok) {
      throw new Error(`MobiMatter API: ${mobiResponse.status}`);
    }

    const { result: products } = await mobiResponse.json();

    // 2. Process products with time monitoring
    for (const product of products) {
      if (getRemainingTime() < 1000) {
        results.skipped = true;
        break;
      }

      try {
        const productData = transformProduct(product);
        
        // Validate required fields
        if (!productData.title) {
          throw new Error("Missing product title");
        }

        // Create Shopify product
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CONFIG.SHOPIFY_TIMEOUT);

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
            }),
            signal: controller.signal
          }
        );

        clearTimeout(timeout);
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
          error: err.message.replace(/\n/g, ' ') // Remove newlines for logs
        });
      }

      results.processed++;
    }

    // 3. Prepare pagination for next run
    const nextOffset = offset + results.processed;
    const hasMore = results.processed === CONFIG.PRODUCTS_PER_RUN && !results.skipped;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        executionTime: `${((Date.now() - startTime)/1000).toFixed(2)}s`,
        stats: {
          totalProcessed: nextOffset,
          created: results.created.length,
          errors: results.errors.length,
          skipped: results.skipped
        },
        ...(hasMore && {
          nextPage: `${event.path}?offset=${nextOffset}`
        }),
        details: {
          created: results.created,
          errors: results.errors
        }
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
        error: "Function execution failed",
        message: err.message,
        executionTime: `${((Date.now() - startTime)/1000).toFixed(2)}s`,
        lastProcessedOffset: event.queryStringParameters?.offset || 0,
        failedBatch: results
      })
    };
  }
};
