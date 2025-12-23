import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET; // TODO: Set this in your environment variables

/*****************
* STRIPE PRODUCTS
******************/

/**
 * Creates a new Product in Stripe
 *
 * @param {Object} config
 * @returns {Promise<Object>} The created Stripe Product object
 *
 * DOCS: https://docs.stripe.com/api/products/create?lang=node
 */
async function createProduct(config) {
    if (!config.name) {
        throw new Error('Product name is required');
    }

    try {
        const product = await stripe.products.create(config);
        return product;
    }
    catch (error) {
        console.error('Error creating Stripe product:', error);
        throw error; // Re-throw for handling upstream
    }
}


/**
 * Updates an existing Product in Stripe
 *
 * @param {*} stripeProductId
 * @param {*} updateData
 * @returns {Promise<Object>} The updated Stripe Product object
 *
 * DOCS: https://docs.stripe.com/api/products/update
 */
async function updateProduct(stripeProductId, updateData) {
    try {
        const product = await stripe.products.update(stripeProductId, updateData);
        return product;
    }
    catch (error) {
        console.error('Error updating Stripe product:', error);
        throw error;
    }
}


/*****************
* STRIPE PRICES
******************/

/**
 * Creates a new Price for an existing Product in Stripe
 * @param {Object} config
 * @returns {Promise<Object>} The created Stripe Price object
 *
 * DOCS: https://docs.stripe.com/api/prices/create?lang=node
 *
 * Note that the "product" config is required (the ID of the existing Stripe Product
 * that this Price is for)
 * https://docs.stripe.com/api/prices/create?lang=node#create_price-product
 */
async function createPrice(config = {}) {
    try {
        const price = await stripe.prices.create({
            currency: 'usd', // https://docs.stripe.com/api/prices/create?lang=node#create_price-currency
            tax_behavior: 'exclusive',  // https://docs.stripe.com/api/prices/create?lang=node#create_price-tax_behavior
            ...config
        });

        return price;
    }
    catch (error) {
        console.error('Error creating Stripe price:', error);
        throw error;
    }
}


/**
 * Updates an existing Price in Stripe
 *
 * @param {string} stripePriceId - The ID of the Price to update
 * @param {Object} updateData - The fields to update
 * @returns {Promise<Object>} The updated Stripe Price object
 *
 * DOCS: https://docs.stripe.com/api/prices/update?lang=node
 *
 * NOTES:
 * The "unit_amount" and "currency" fields cannot be updated once a Price is created.
 */
async function updatePrice(stripePriceId, updateData) {
    try {
        const price = await stripe.prices.update(stripePriceId, updateData);
        return price;
    }
    catch (error) {
        console.error('Error updating Stripe price:', error);
        throw error;
    }
}


/**
 * Finds Prices matching a specific unit_amount (in cents)
 * Note: Stripe does not support server-side filtering by amount, so we fetch and filter client-side.
 *
 * @param {Object} options
 * @param {number} options.unitAmount - Required: The exact amount in cents (e.g., 2999 for $29.99)
 * @param {string} [options.currency='usd'] - Optional: Filter by currency first (recommended for performance)
 * @param {string} [options.productId] - Optional: Filter by specific product ID
 * @param {boolean} [options.active=true] - Optional: Only active prices
 * @param {number} [options.limit=100] - Optional: Max prices to fetch (Stripe default is 10, max 100 per page)
 * @returns {Promise<Array<Object>>} Array of matching Stripe Price objects
 */
async function findPricesByAmount({
    unitAmount, // in cents
    currency = 'usd',
    productId = null,
    active = true,
    limit = 100,
}) {
    if (unitAmount && typeof unitAmount !== 'number') {
        throw new Error('unitAmount (in cents) is required and must be a number');
    }

    try {
        // Fetch prices with available server-side filters
        const params = {
            limit,
            active,
            currency,
            ...(productId && { product: productId }),
        };

        const stipePrices = await stripe.prices.list(params)
        console.log('STRIPEPRICES', stipePrices);

        // Use auto-pagination to handle >100 prices if needed
        const matchingPrices = [];

        // If filtering by unitAmount
        if (unitAmount) {
            for (const price of stipePrices.data) {
                if (price.unit_amount === unitAmount) {
                    matchingPrices.push(price);
                }
            }
        }
        else {
            // If no unitAmount filter, return all fetched prices
            matchingPrices.push(...stipePrices.data);
        }

        return matchingPrices;
    }
    catch (error) {
        console.error('Error finding prices by amount:', error);
        throw error;
    }
}



/*****************
* STRIPE TAX CODES
******************/

/**
* Retrieves all Tax Codes from Stripe
*
* @param {Object} params - Optional parameters for listing tax codes
* @returns {Promise<Array<Object>>} Array of Stripe Tax Code objects
*
* DOCS: https://docs.stripe.com/api/tax_codes?lang=node
* ALL TAX CODES AVAILABLE FROM STRIPE: https://docs.stripe.com/tax/tax-codes
*/
async function getTaxCodes(params) {
    const taxCodes = await stripe.taxCodes.list({
        limit: 100, // https://docs.stripe.com/api/tax_codes/list?lang=node#list_tax_codes-limit
        ...params
    });

    return taxCodes?.data;
}


/**
 * Retrieves a single Tax Code by ID from Stripe
 *
 * @param {string} taxCodeId - The ID of the tax code to retrieve
 * @returns {Promise<Object>} The Stripe Tax Code object
 *
 * DOCS: https://docs.stripe.com/api/tax_codes/retrieve?lang=node
 */
async function getTaxCode(taxCodeId) {
    const taxCode = await stripe.taxCodes.retrieve(taxCodeId);
    return taxCode;
}


/*****************
* MISC STRIPE FUNCTIONS
******************/

/**
 * Creates a Checkout Session for one-time or subscription payments
 * @param {Object} sessionData
 * @param {string[]} sessionData.lineItems - Array of { price: priceId, quantity: number }
 * @param {string} sessionData.mode - 'payment' (one-time) or 'subscription'
 * @param {string} sessionData.successUrl - URL to redirect after success
 * @param {string} sessionData.cancelUrl - URL to redirect after cancel
 * @param {string} [sessionData.customerId] - Existing customer ID (optional)
 * @param {Object} [sessionData.metadata] - Optional metadata
 * @returns {Promise<Object>} The created Checkout Session object
 */
async function createCheckoutSession({
    lineItems,
    mode = 'payment',
    successUrl,
    cancelUrl,
    customerId = null,
    metadata = {},
}) {
    if (!lineItems || lineItems.length === 0 || !successUrl || !cancelUrl) {
        throw new Error('lineItems, successUrl, and cancelUrl are required');
    }

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'], // Can add more like 'afterpay_clearpay', etc.
            line_items: lineItems,
            mode,
            success_url: successUrl,
            cancel_url: cancelUrl,
            customer: customerId,
            metadata,
        });

        return session;
    }
    catch (error) {
        console.error('Error creating Checkout Session:', error);
        throw error;
    }
}


/**
 * Creates a Payment Intent for custom payment flows
 * @param {Object} intentData
 * @param {number} intentData.amount - Amount in cents
 * @param {string} intentData.currency - e.g., 'usd'
 * @param {string} [intentData.customerId] - Optional customer ID
 * @param {Object} [intentData.metadata] - Optional metadata
 * @returns {Promise<Object>} The created Payment Intent object
 */
async function createPaymentIntent({
    amount,
    currency = 'usd',
    customerId = null,
    metadata = {},
}) {
    if (!amount) {
        throw new Error('amount is required');
    }

    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency,
            customer: customerId,
            metadata,
        });

        return paymentIntent;
    }
    catch (error) {
        console.error('Error creating Payment Intent:', error);
        throw error;
    }
}


/**
 * Verifies a Stripe webhook event
 * @param {string} payload - Raw request body
 * @param {string} signature - Stripe-Signature header
 * @returns {Object} Verified Stripe Event object
 */
function verifyWebhookEvent(payload, signature) {
    if (!webhookSecret) {
        throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    }

    try {
        const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
        return event;
    }
    catch (error) {
        console.error('Webhook signature verification failed:', error);
        throw error;
    }
}


export default {
    stripe,
    createProduct,
    updateProduct,
    createPrice,
    updatePrice,
    createCheckoutSession,
    createPaymentIntent,
    findPricesByAmount,
    getTaxCodes,
    getTaxCode,
    verifyWebhookEvent,
};
