import CartService from './CartService.js';
import ProductService from '../products/ProductService.js';
import StripeService from '../stripe/StripeService.js';
import db from '../../db/knex.js';

const CartSvc = new CartService();
const ProductSvc = new ProductService();

const CHECKOUT_SESSION_ID_PREFIX = 'cs_';

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
export async function createCheckoutForCart(cartId) {
    const cart = await CartSvc.fetchOne({ where: { id: cartId } });

    if(!cart || cart.closed_at) {
        throw new Error('Cart is not available for checkout');
    }

    const cartItems = (cart.cart_items || []).filter((item) => item.qty > 0);
    if(!cartItems.length) {
        throw new Error('Cart is empty');
    }

    const lineItems = [];

    for(const item of cartItems) {
        const product = await ProductSvc.fetchOne({ where: { id: item.product?.id } });

        if(!product || !product.published) {
            throw new Error(`"${item.product?.title || 'An item'}" is no longer available`);
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
    if(cart.stripe_order_id?.startsWith(CHECKOUT_SESSION_ID_PREFIX)) {
        await StripeService.expireCheckoutSession(cart.stripe_order_id);
    }

    const storefrontUrl = getStorefrontUrl();

    const session = await StripeService.createCheckoutSession({
        lineItems,
        successUrl: `${storefrontUrl}/order/complete?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${storefrontUrl}/`,
        clientReferenceId: cart.id,
        metadata: { cart_id: cart.id },
        automaticTax: process.env.STRIPE_AUTOMATIC_TAX === 'true',
    });

    await db('carts').where({ id: cart.id }).update({
        stripe_order_id: session.id,
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
        // e.g. delayed payment methods; wait for async_payment_succeeded
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

    return { handled: true, cartId };
}
