const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const COUNTRY_NAMES = {
  US: 'United States', GB: 'United Kingdom', FR: 'France', DE: 'Germany', IT: 'Italy',
  ES: 'Spain', JP: 'Japan', KR: 'South Korea', CN: 'China', IN: 'India',
  BR: 'Brazil', CA: 'Canada', AU: 'Australia', NZ: 'New Zealand', SG: 'Singapore',
  ME: 'Montenegro', RS: 'Serbia', VN: 'Vietnam', BG: 'Bulgaria', ID: 'Indonesia',
  // Add more as needed
};

const COUNTRY_FLAGS = {
  US: '🇺🇸', GB: '🇬🇧', FR: '🇫🇷', DE: '🇩🇪', IT: '🇮🇹',
  ES: '🇪🇸', JP: '🇯🇵', KR: '🇰🇷', CN: '🇨🇳', IN: '🇮🇳',
  BR: '🇧🇷', CA: '🇨🇦', AU: '🇦🇺', NZ: '🇳🇿', SG: '🇸🇬',
  ME: '🇲🇪', RS: '🇷🇸', VN: '🇻🇳', BG: '🇧🇬', ID: '🇮🇩',
  // Add more as needed
};

const getCountryLabel = (code) => {
  const flag = COUNTRY_FLAGS[code] || '🌍';
  const name = COUNTRY_NAMES[code] || code;
  return `${flag} ${name}`;
};

const extractDetails = (product) => {
  const details = {};
  (product.productDetails || []).forEach(({ name, value }) => {
    details[name.trim()] = value;
  });
  return details;
};

const buildDescriptionHtml = (product, details) => {
  const countries = (product.countries || []).map(getCountryLabel).map(c => `<li>${c}</li>`).join('');
  return `
    <div class="esim-description">
      <h3>${details.PLAN_TITLE || product.productFamilyName || 'eSIM Plan'}</h3>
      ${countries ? `<div class="countries-section"><p><strong>Countries:</strong></p><ul>${countries}</ul></div>` : ''}
      <p><strong>Data:</strong> ${details.PLAN_DATA_LIMIT || 'Unlimited'} ${details.PLAN_DATA_UNIT || 'GB'}</p>
      <p><strong>Validity:</strong> ${details.PLAN_VALIDITY || '30'} days</p>
      ${details.FIVEG === '1' ? '<p><strong>Network:</strong> 5G Supported</p>' : ''}
      ${details.SPEED ? `<p><strong>Speed:</strong> ${details.SPEED}</p>` : ''}
      ${details.TOPUP === '1' ? '<p><strong>Top-up:</strong> Available</p>' : ''}
      <p><strong>Provider:</strong> ${product.providerName || 'Mobimatter'}</p>
    </div>
  `;
};

exports.handler = async function () {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = '2025-04'
  } = process.env;

  const created = [];
  const failed = [];

  try {
    const mobimatterRes = await fetch('https://api.mobimatter.com/mobimatter/api/v2/products', {
      headers: {
        'api-key': MOBIMATTER_API_KEY,
        'merchantId': MOBIMATTER_MERCHANT_ID
      }
    });

    if (!mobimatterRes.ok) {
      throw new Error(`Mobimatter fetch failed: ${mobimatterRes.status}`);
    }

    const { result: products } = await mobimatterRes.json();

    for (const product of products.slice(0, 10)) {
      const details = extractDetails(product);
      const title = details.PLAN_TITLE || product.productFamilyName || 'Unnamed eSIM';
      const price = product.retailPrice?.toFixed(2);
      if (!title || !price) {
        failed.push({ title: title || '(missing)', reason: 'Missing title or price' });
        continue;
      }

      const mutation = `
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
          descriptionHtml: buildDescriptionHtml(product, details),
          vendor: product.providerName || 'Mobimatter',
          productType: 'eSIM',
          tags: [
            details.FIVEG === '1' ? '5G' : '4G',
            `data-${details.PLAN_DATA_LIMIT || 'unlimited'}${details.PLAN_DATA_UNIT || 'GB'}`,
            ...(product.countries || []).map(c => `country-${c}`)
          ],
          status: 'ACTIVE',
          published: true,
          publication: {
            publishDate: new Date().toISOString()
          },
          variants: [
            {
              price: price,
              sku: product.uniqueId,
              inventoryQuantity: 999999,
              fulfillmentService: 'manual',
              inventoryManagement: null,
              taxable: true
            }
          ],
          images: product.providerLogo ? [{ src: product.providerLogo }] : []
        }
      };

      const shopifyRes = await fetch(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_KEY
          },
          body: JSON.stringify({ query: mutation, variables })
        }
      );

      const shopifyJson = await shopifyRes.json();
      const errors = shopifyJson?.data?.productCreate?.userErrors;

      if (!shopifyRes.ok || (errors && errors.length)) {
        failed.push({
          title,
          reason: errors?.map(e => e.message).join(', ') || `Status ${shopifyRes.status}`
        });
      } else {
        created.push(title);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Created ${created.length} product(s)`, created, failed })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Mobimatter fetch or Shopify sync failed',
        message: err.message
      })
    };
  }
};
