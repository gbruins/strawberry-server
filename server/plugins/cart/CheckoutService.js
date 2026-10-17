import CartService from './CartService.js';
import ProductService from '../products/ProductService.js';
import StripeService from '../stripe/StripeService.js';
import db from '../../db/knex.js';
import Boom from '@hapi/boom';
import ServiceStream from '../service/ServiceStream.js';
import {
    HOLD_MARGIN_MS,
    PROVISIONAL_HOLD_MS,
    getRemaining,
    countCartPizzas,
    openServiceQuery,
    limitError
} from '../service/ServiceStock.js';

const CartSvc = new CartService();
const ProductSvc = new ProductService();

const CHECKOUT_SESSION_ID_PREFIX = 'cs_';

const isSessionId = (value) => typeof value === 'string' && value.startsWith(CHECKOUT_SESSION_ID_PREFIX);

const clearSession = (cartId, sessionId) => {
    return db('carts')
        .where({ id: cartId, stripe_order_id: sessionId })
        .whereNull('closed_at')
        .update({ stripe_order_id: null, checkout_expires_at: null, updated_at: db.fn.now() });
};


/**
 * Releases a checkout hold, returning its pizzas to the pool.
 */
export async function releaseCheckoutHold(cartId) {
    await db('carts')
        .where({ id: cartId })
        .whereNull('closed_at')
        .update({ checkout_expires_at: null, updated_at: db.fn.now() });

    ServiceStream.publish();
}


/**
 * Checks the service window, the per-order cap and the stock, and writes a hold on
 * the cart's pizzas, all while the service row is locked so that two checkouts can
 * never take the last pizza. The hold is provisional until the Stripe session exists.
 *
 * @throws a 409 Boom with a code: service_closed, sold_out or over_limit
 */
export async function reserveCheckoutStock(cartId, { now = new Date() } = {}) {
    await db.transaction(async (trx) => {
        const cart = await trx('carts').where({ id: cartId }).whereNull('deleted_at').first('id', 'service_id');

        const service = cart?.service_id
            ? await trx('service').where({ id: cart.service_id }).forUpdate().first()
            : await openServiceQuery(trx, now).forUpdate().first();

        if(!service || new Date(service.start_at) > now || new Date(service.end_at) <= now) {
            throw limitError(Boom, 'service_closed');
        }

        const pizzas = await countCartPizzas(cartId, {}, trx);

        if(pizzas > 0) {
            const remaining = await getRemaining(service, { now, excludeCartId: cartId }, trx);

            if(remaining <= 0) {
                throw limitError(Boom, 'sold_out');
            }

            if(pizzas > Math.min(service.max_per_order, remaining)) {
                throw limitError(Boom, 'over_limit', { max_per_order: service.max_per_order, remaining });
            }
        }

        await trx('carts').where({ id: cartId }).update({
            service_id: service.id,
            checkout_expires_at: new Date(now.getTime() + PROVISIONAL_HOLD_MS),
            updated_at: trx.fn.now()
        });
    });
}


/**
 * Whether the cart has a Stripe Checkout Session that can still be paid
 * (or has just been paid and is waiting for its webhook). Carts are locked
 * against edits while this is true, so what is paid always matches the cart.
 * Expired sessions are released.
 */
export async function isCheckoutInProgress(cartId, sessionId) {
    if(!isSessionId(sessionId)) {
        return false;
    }

    const session = await StripeService.retrieveCheckoutSession(sessionId);

    if(session.status === 'expired') {
        await clearSession(cartId, sessionId);
        return false;
    }

    return true;
}


/**
 * Abandons an open checkout so the cart can be edited again.
 *
 * @returns {Promise<{ status: 'cancelled' | 'none' | 'complete' }>}
 */
export async function cancelCheckout(cartId) {
    const cart = await db('carts').where({ id: cartId }).whereNull('deleted_at').first('stripe_order_id');
    const sessionId = cart?.stripe_order_id;

    if(!isSessionId(sessionId)) {
        await releaseCheckoutHold(cartId);
        return { status: 'none' };
    }

    const session = await StripeService.retrieveCheckoutSession(sessionId);

    if(session.status === 'complete') {
        return { status: 'complete' };
    }

    if(session.status === 'open') {
        await StripeService.expireCheckoutSession(sessionId);
    }

    await clearSession(cartId, sessionId);
    ServiceStream.publish();

    return { status: 'cancelled' };
}

function getStorefrontUrl() {
    const url = process.env.STOREFRONT_URL;

    if(!url) {
        throw new Error('STOREFRONT_URL is not set');
    }

    return url.replace(/\/+$/, '');
}


/**
 * Creates a Stripe Checkout Session for a cart.
 *
 * Line items are built from the current product prices in the database,
 * never from anything the client sends or from the price snapshot stored on
 * the cart item.
 *
 * @returns {Promise<{ url: string }>}
 */
const checkoutLocks = new Map();

// Serializes checkout creation per cart so two simultaneous requests cannot both create a
// payable session. In-process, like the service stream; multi-instance needs a database lock.
async function withCartLock(cartId, fn) {
    const previous = checkoutLocks.get(cartId) || Promise.resolve();
    const current = previous.catch(() => {}).then(fn);
    const tail = current.catch(() => {});

    checkoutLocks.set(cartId, tail);

    try {
        return await current;
    }
    finally {
        if(checkoutLocks.get(cartId) === tail) {
            checkoutLocks.delete(cartId);
        }
    }
}

const itemUnavailable = (productId, title) => {
    return Boom.conflict(`"${title || 'An item'}" is no longer available`, {
        code: 'item_unavailable',
        product_id: productId || null,
        title: title || null
    });
};

export function createCheckoutForCart(cartId) {
    return withCartLock(cartId, () => createCheckout(cartId));
}

async function createCheckout(cartId) {
    const cart = await CartSvc.fetchOne({ where: { id: cartId } });

    if(!cart || cart.closed_at) {
        throw new Error('Cart is not available for checkout');
    }

    const cartItems = (cart.cart_items || []).filter((item) => item.qty > 0);
    if(!cartItems.length) {
        throw new Error('Cart is empty');
    }

    // Product ids offered by the service's current published menu (FR-008a)
    let offeredIds = null;
    if(cart.service_id) {
        const offered = await db('service as s')
            .join('service_menus as m', 'm.id', 's.service_menu_id')
            .join('service_menu_products as smp', 'smp.service_menu_id', 'm.id')
            .where('s.id', cart.service_id)
            .where('m.published', true)
            .whereNull('m.deleted_at')
            .select('smp.product_id');
        offeredIds = new Set(offered.map((row) => row.product_id));
    }

    const lineItems = [];

    for(const item of cartItems) {
        const product = await ProductSvc.fetchOne({ where: { id: item.product?.id } });

        if(!product || !product.published) {
            throw itemUnavailable(item.product?.id, item.product?.title);
        }

        if(offeredIds && !offeredIds.has(product.id)) {
            throw itemUnavailable(product.id, product.title);
        }

        if(product.stripe_price_id) {
            lineItems.push({ price: product.stripe_price_id, quantity: item.qty });
        }
        else if(Number.isInteger(product.base_price) && product.base_price > 0) {
            lineItems.push({
                quantity: item.qty,
                price_data: {
                    currency: cart.currency || 'usd',
                    unit_amount: product.base_price,
                    product_data: {
                        name: product.title,
                        ...(product.stripe_tax_code ? { tax_code: product.stripe_tax_code } : {})
                    }
                }
            });
        }
        else {
            throw new Error(`"${product.title}" has no price`);
        }
    }

    // Only one live session per cart, otherwise a customer could pay twice
    if(isSessionId(cart.stripe_order_id)) {
        const previous = await StripeService.retrieveCheckoutSession(cart.stripe_order_id);

        if(previous.status === 'complete') {
            throw new Error('A payment for this cart is already being processed');
        }

        // Pay pressed twice, or Continue to payment: hand back the same page
        if(previous.status === 'open' && previous.url) {
            return { url: previous.url };
        }

        if(previous.status === 'open') {
            await StripeService.expireCheckoutSession(previous.id);
        }
    }

    const storefrontUrl = getStorefrontUrl();

    await reserveCheckoutStock(cart.id);
    ServiceStream.publish();

    let session;

    try {
        session = await StripeService.createCheckoutSession({
            lineItems,
            successUrl: `${storefrontUrl}/order/complete?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${storefrontUrl}/cart?checkout=cancelled`,
            clientReferenceId: cart.id,
            metadata: { cart_id: cart.id },
            automaticTax: process.env.STRIPE_AUTOMATIC_TAX === 'true',
        });
    }
    catch(err) {
        await releaseCheckoutHold(cart.id);
        throw err;
    }

    // The hold outlasts the session so a customer can never pay after it is released
    const holdUntil = session.expires_at
        ? new Date(session.expires_at * 1000 + HOLD_MARGIN_MS)
        : new Date(Date.now() + PROVISIONAL_HOLD_MS + HOLD_MARGIN_MS);

    await db('carts').where({ id: cart.id }).update({
        stripe_order_id: session.id,
        checkout_expires_at: holdUntil,
        updated_at: db.fn.now()
    });

    return { url: session.url };
}


/**
 * Completes a cart from a verified checkout.session.completed event.
 * Safe to call repeatedly: Stripe retries webhooks.
 */
export async function completeCartFromSession(session) {
    const cartId = session.client_reference_id || session.metadata?.cart_id;

    if(!cartId) {
        global.logger.error('Checkout: session has no cart reference', { meta: { session_id: session.id } });
        return { handled: false };
    }

    if(session.payment_status !== 'paid') {
        return { handled: false };
    }

    const cart = await db('carts').where({ id: cartId }).whereNull('deleted_at').first();

    if(!cart) {
        global.logger.error('Checkout: paid session for a cart that does not exist', {
            meta: { session_id: session.id, cart_id: cartId }
        });
        return { handled: false };
    }

    if(cart.closed_at) {
        if(cart.stripe_order_id !== session.id) {
            global.logger.error('Checkout: cart was already paid by another session, refund required', {
                meta: { session_id: session.id, cart_id: cartId, paid_session_id: cart.stripe_order_id }
            });
        }

        return { handled: false };
    }

    const details = session.customer_details || {};
    const address = details.address || {};
    const [firstName, ...rest] = (details.name || '').trim().split(/\s+/);
    const billing = {
        billing_firstName: firstName || null,
        billing_lastName: rest.join(' ') || null,
        billing_streetAddress: address.line1 || null,
        billing_extendedAddress: address.line2 || null,
        billing_city: address.city || null,
        billing_state: address.state || null,
        billing_postalCode: address.postal_code || null,
        billing_countryCodeAlpha2: address.country || null,
        billing_phone: details.phone || null,
    };

    const serverCart = await CartSvc.fetchOne({ where: { id: cartId } });

    // The cart may have been edited after the session was created
    if(serverCart && serverCart.price_subtotal !== session.amount_subtotal) {
        global.logger.error('Checkout: paid amount differs from current cart contents, review order', {
            meta: {
                session_id: session.id,
                cart_id: cartId,
                cart_subtotal: serverCart.price_subtotal,
                paid_subtotal: session.amount_subtotal
            }
        });
    }

    await db('carts').where({ id: cartId }).whereNull('closed_at').update({
        ...billing,
        sales_tax: session.total_details?.amount_tax ?? 0,
        currency: session.currency || cart.currency,
        stripe_payment_intent_id: typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id || null,
        stripe_order_id: session.id,
        closed_at: db.fn.now(),
        updated_at: db.fn.now()
    });

    ServiceStream.publish();

    return { handled: true, cartId };
}
