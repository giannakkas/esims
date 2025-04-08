const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Configuration
const CONFIG = {
  SAFETY_TIMEOUT: 9000,
  PRODUCTS_PER_RUN: 5,
  MOBIMATTER_API_URL: "https://api.mobimatter.com/mobimatter/api/v2/products",
  SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || "2025-04"
};

// Updated GraphQL mutation without images in initial creation
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

// Separate mutation for image upload
const SHOPIFY_IMAGE_MUTATION = `
  mutation productImageCreate($productId: ID!, $image: ImageInput!) {
    productImageCreate(productId: $productId, image: $image) {
      productImage {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

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
    // REMOVED images from initial creation
    providerLogo: product.providerLogo // Will be added later
  };
};

// Helper function to add images after product creation
const addProductImage = async (productId, imageUrl) => {
  if (!imageUrl) return null;

  const response = await fetch(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${CONFIG.SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_KEY,
      },
      body: JSON.stringify({
        query: SHOPIFY_IMAGE_MUTATION,
        variables: {
          productId: `gid://shopify/Product/${productId}`,
          image: { src: imageUrl }
        }
      })
    }
  );

  return response.json();
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
    const getRemainingTime = () => CONFIG.SAFETY_TIMEOUT - (Date.now() - startTime);

    // 1. Fetch products
    const offset = event.queryStringParameters?.offset || 0;
    const apiUrl = `${CONFIG.MOBIMATTER_API_URL}?limit=${CONFIG.PRODUCTS_PER_RUN}&offset=${offset}`;
    
    if (getRemainingTime() < 2000) {
      throw new Error("Insufficient time remaining");
    }

    const mobiResponse = await fetch(apiUrl, {
      headers: {
        "api-key": process.env.MOBIMATTER_API_KEY,
        "merchantId": process.env.MOBIMATTER_MERCHANT_ID,
        "Ocp-Apim-Subscription-Key": process.env.MOBIMATTER_SUBSCRIPTION_KEY
      },
      timeout: 2000
    });

    if (!mobiResponse.ok) throw new Error(`MobiMatter API: ${mobiResponse.status}`);
    const { result: products } = await mobiResponse.json();

    // 2. Process products
    for (const product of products) {
      if (getRemainingTime() < 1000) {
        results.skipped = true;
        break;
      }

      try {
        const productData = transformProduct(product);
        
        // 3. Create product (without images)
        const createResponse = await fetch(
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

        const createData = await createResponse.json();
        
        if (createData.errors || createData.data?.productCreate?.userErrors?.length) {
          throw new Error(
            createData.errors?.[0]?.message || 
            createData.data?.productCreate?.userErrors?.[0]?.message
          );
        }

        const productId = createData.data?.productCreate?.product?.id?.split('/').pop();
        
        // 4. Add image separately if exists
        if (productData.providerLogo && productId) {
          await addProductImage(productId, productData.providerLogo);
        }

        results.created.push(productData.title);
      } catch (err) {
        results.errors.push({
          product: product.productFamilyName || "Unnamed Product",
          error: err.message.replace(/\n/g, ' ')
        });
      }

      results.processed++;
    }

    // Return results
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        executionTime: `${((Date.now() - startTime)/1000).toFixed(2)}s`,
        stats: {
          totalProcessed: offset + results.processed,
          created: results.created.length,
          errors: results.errors.length,
          skipped: results.skipped
        },
        ...(results.processed === CONFIG.PRODUCTS_PER_RUN && !results.skipped && {
          nextPage: `${event.path}?offset=${offset + results.processed}`
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
        failedBatch: results
      })
    };
  }
};
