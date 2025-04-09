const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Configuration
const CONFIG = {
  SAFETY_TIMEOUT: 9500,         // 9.5s safety margin
  PRODUCTS_PER_RUN: 5,          // Optimal batch size
  MOBIMATTER_API_URL: "https://api.mobimatter.com/mobimatter/api/v2/products",
  SHOPIFY_API_VERSION: "2024-01", // Stable API version
  API_TIMEOUTS: {
    mobimatter: 2000,           // 2s for product fetch
    shopify: 3000               // 3s for Shopify operations
  }
};

// Country code to flag emoji mapping
const COUNTRY_FLAGS = {
  US: '🇺🇸', GB: '🇬🇧', FR: '🇫🇷', DE: '🇩🇪', IT: '🇮🇹',
  ES: '🇪🇸', JP: '🇯🇵', KR: '🇰🇷', CN: '🇨🇳', IN: '🇮🇳',
  BR: '🇧🇷', CA: '🇨🇦', AU: '🇦🇺', NZ: '🇳🇿', SG: '🇸🇬',
  ME: '🇲🇪', RS: '🇷🇸', VN: '🇻🇳', BG: '🇧🇬', ID: '🇮🇩'
};

// Helper to extract product details
const getProductDetails = (product) => {
  const details = {};
  (product.productDetails || []).forEach(({ name, value }) => {
    details[name.trim()] = value;
  });
  return details;
};

// Build countries section with flags
const buildCountriesSection = (countries) => {
  if (!countries || !countries.length) return '';
  
  return `
    <div class="countries-section">
      <p><strong>Countries:</strong></p>
      <ul>
        ${countries.map(country => {
          const flag = COUNTRY_FLAGS[country] || '🌐';
          return `<li>${flag} ${country}</li>`;
        }).join('')}
      </ul>
    </div>
  `;
};

// Build full description HTML
const buildDescription = (product, details) => {
  return `
    <div class="esim-description">
      <h3>${details.PLAN_TITLE || product.productFamilyName || 'eSIM Plan'}</h3>
      ${buildCountriesSection(product.countries)}
      <p><strong>Data:</strong> ${details.PLAN_DATA_LIMIT || 'Unlimited'} ${details.PLAN_DATA_UNIT || 'GB'}</p>
      <p><strong>Validity:</strong> ${details.PLAN_VALIDITY || '30'} days</p>
      ${details.FIVEG === "1" ? '<p><strong>Network:</strong> 5G Supported</p>' : ''}
      ${details.SPEED ? `<p><strong>Speed:</strong> ${details.SPEED}</p>` : ''}
      ${details.TOPUP === "1" ? '<p><strong>Top-up:</strong> Available</p>' : ''}
      <p><strong>Provider:</strong> ${product.providerName || 'Mobimatter'}</p>
    </div>
  `;
};

exports.handler = async (event) => {
  const startTime = Date.now();
  const results = {
    processed: 0,
    created: [],
    errors: []
  };

  try {
    // 1. Fetch products with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUTS.mobimatter);
    
    const mobiResponse = await fetch(CONFIG.MOBIMATTER_API_URL, {
      signal: controller.signal,
      headers: {
        "api-key": process.env.MOBIMATTER_API_KEY,
        "merchantId": process.env.MOBIMATTER_MERCHANT_ID,
        "Ocp-Apim-Subscription-Key": process.env.MOBIMATTER_SUBSCRIPTION_KEY
      }
    });
    clearTimeout(timeout);

    if (!mobiResponse.ok) {
      throw new Error(`MobiMatter API failed: ${mobiResponse.status} ${await mobiResponse.text()}`);
    }
    
    const { result: products } = await mobiResponse.json();
    if (!products?.length) throw new Error("No products found in Mobimatter response");

    // 2. Process products with time checks
    for (const product of products.slice(0, CONFIG.PRODUCTS_PER_RUN)) {
      if (Date.now() - startTime > CONFIG.SAFETY_TIMEOUT) {
        results.skipped = true;
        break;
      }

      try {
        const details = getProductDetails(product);
        const price = (product.retailPrice?.toFixed(2) || "0.00";

        // Prepare Shopify product input
        const productInput = {
          title: details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM",
          descriptionHtml: buildDescription(product, details),
          productType: "eSIM",
          vendor: product.providerName || "Mobimatter",
          tags: [
            details.FIVEG === "1" ? "5G" : "4G",
            `data-${details.PLAN_DATA_LIMIT || 'unlimited'}${details.PLAN_DATA_UNIT || 'GB'}`,
            ...(product.countries || []).map(c => `country-${c}`)
          ],
          status: "ACTIVE",
          variants: [{
            price: price.toString(), // Critical: must be string
            sku: product.uniqueId,
            inventoryQuantity: 999999,
            fulfillmentService: "manual",
            inventoryManagement: "shopify",
            taxable: true,
            requiresShipping: false
          }],
          images: [{
            src: product.providerLogo || 'https://via.placeholder.com/150',
          }]
        };

        // 3. Create Shopify product
        const shopifyResponse = await fetch(
          `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${CONFIG.SHOPIFY_API_VERSION}/graphql.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_KEY,
              "Accept": "application/json"
            },
            body: JSON.stringify({
              query: `mutation productCreate($input: ProductInput!) {
                productCreate(input: $input) {
                  product { id title variants(first: 1) { edges { node { id price } } } }
                  userErrors { field message }
                }
              }`,
              variables: { input: productInput }
            })
          }
        );

        const responseData = await shopifyResponse.json();
        
        // Enhanced error handling
        if (!shopifyResponse.ok) {
          throw new Error(`Shopify API error: ${shopifyResponse.status}`);
        }
        if (responseData.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(responseData.errors)}`);
        }
        if (responseData.data?.productCreate?.userErrors?.length) {
          throw new Error(`User errors: ${
            responseData.data.productCreate.userErrors.map(e => `${e.field}: ${e.message}`).join(', ')
          }`);
        }

        results.created.push({
          title: responseData.data.productCreate.product.title,
          id: responseData.data.productCreate.product.id
        });
        results.processed++;
        
      } catch (err) {
        console.error(`Failed to process product ${product.uniqueId}:`, err);
        results.errors.push({
          product: product.productFamilyName || "Unnamed",
          sku: product.uniqueId,
          error: err.message
        });
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        executionTime: `${((Date.now() - startTime)/1000).toFixed(2)}s`,
        stats: {
          totalProducts: products.length,
          processed: results.processed,
          created: results.created.length,
          errors: results.errors.length
        },
        createdProducts: results.created,
        errors: results.errors,
        nextSteps: results.processed === CONFIG.PRODUCTS_PER_RUN ? 
          "Run again to process more products" : "All products processed"
      })
    };

  } catch (err) {
    console.error("Critical error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: "Processing failed",
        message: err.message,
        executionTime: `${((Date.now() - startTime)/1000).toFixed(2)}s`
      })
    };
  }
};
