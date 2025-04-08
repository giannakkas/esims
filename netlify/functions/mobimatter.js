const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Configuration
const CONFIG = {
  SAFETY_TIMEOUT: 9500,         // 9.5s safety margin
  PRODUCTS_PER_RUN: 5,          // Optimal batch size
  MOBIMATTER_API_URL: "https://api.mobimatter.com/mobimatter/api/v2/products",
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
    const mobiResponse = await fetch(CONFIG.MOBIMATTER_API_URL, {
      headers: {
        "api-key": process.env.MOBIMATTER_API_KEY,
        "merchantId": process.env.MOBIMATTER_MERCHANT_ID,
        "Ocp-Apim-Subscription-Key": process.env.MOBIMATTER_SUBSCRIPTION_KEY
      },
      timeout: CONFIG.API_TIMEOUTS.mobimatter
    });

    if (!mobiResponse.ok) throw new Error(`MobiMatter API: ${mobiResponse.status}`);
    const { result: products } = await mobiResponse.json();

    console.log(`Fetched ${products.length} products.`); // Log fetched products

    // 2. Process products with time checks
    for (const product of products.slice(0, CONFIG.PRODUCTS_PER_RUN)) {
      if (Date.now() - startTime > CONFIG.SAFETY_TIMEOUT) {
        results.skipped = true;
        break;
      }

      try {
        const details = getProductDetails(product);
        console.log(`Processing product: ${details.PLAN_TITLE || product.productFamilyName}`); // Log product being processed
        
        // 3. Create Shopify product with enhanced description
        const createResponse = await fetch(
          `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-04'}/graphql.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_KEY,
            },
            body: JSON.stringify({
              query: `mutation productCreate($input: ProductInput!) {
                productCreate(input: $input) {
                  product { id title descriptionHtml }
                  userErrors { field message }
                }
              }`,
              variables: {
                input: {
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
                  variants: [
                    {
                      price: product.retailPrice || "Not Available",
                      sku: product.uniqueId,
                      inventory_quantity: 999999,
                      fulfillment_service: "manual",
                      inventory_management: null,
                      taxable: true,
                    }
                  ],
                  images: [
                    {
                      src: product.providerLogo || 'https://via.placeholder.com/150', // Placeholder if logo is missing
                    }
                  ]
                }
              }
            }),
            timeout: CONFIG.API_TIMEOUTS.shopify
          }
        );

        const createData = await createResponse.json();
        console.log(createData); // Log Shopify response for debugging

        if (createData.errors) throw new Error(createData.errors[0].message);

        results.created.push({
          title: createData.data.productCreate.product.title,
          countries: product.countries || []
        });
        results.processed++;
      } catch (err) {
        results.errors.push({
          product: product.productFamilyName || "Unnamed",
          error: err.message
        });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
        stats: {
          totalProducts: products.length,
          processed: results.processed,
          created: results.created.length,
          errors: results.errors.length
        },
        sampleDescription: buildDescription(products[0], getProductDetails(products[0])),
        nextSteps: results.processed === CONFIG.PRODUCTS_PER_RUN ? 
          "Run again to process more products" : null
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Processing failed",
        message: err.message,
        executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`
      })
    };
  }
};
