import CartService from './CartService.js';
import ProductService from '../products/ProductService.js';
import StripeService from '../stripe/StripeService.js';
import db from '../../db/knex.js';
import Boom from '@hapi/boom';
import { touchServiceActivity } from '../service/ServiceActivity.js';
import { allocatePickupCode } from './PickupCodeService.js';
import { sendReceiptEmail } from '../notifications/NotificationService.js';
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

const clearSession = (cartId, sessionId, trx = db) => {
    return trx('carts')
        .where({ id: cartId, stripe_order_id: sessionId })
        .whereNull('closed_at')
        .update({ stripe_order_id: null, checkout_expires_at: null, updated_at: trx.fn.now() });
};


/**
 * Releases a checkout hold, returning its pizzas to the pool.
 */
export async function releaseCheckoutHold(cartId, trx = db, tenantId) {
    await trx('carts')
        .where({ id: cartId })
        .whereNull('closed_at')
        .update({ checkout_expires_at: null, updated_at: trx.fn.now() });

    await touchServiceActivity(tenantId, trx);
}


/**
 * Checks the service window, the per-order cap and the stock, and writes a hold on
 * the cart's pizzas, all while the service row is locked so that two checkouts can
 * never take the last pizza. The hold is provisional until the Stripe session exists.
 *
 * Deliberately opens its OWN short transaction (scoped to `tenantId`) rather than using the
 * caller's ambient request transaction: `createCheckout` calls this, then makes a slow Stripe
 * API call afterward — if the FOR UPDATE lock on the service row were held on the same
 * transaction as that Stripe call, two concurrent checkouts for a near-sold-out service would
 * serialize through the entire Stripe round-trip instead of just this quick DB check. Committing
 * here releases the lock immediately, same as the original design before tenant-scoping existed.
 *
 * @throws a 409 Boom with a code: service_closed, sold_out or over_limit
 */
export async function reserveCheckoutStock(cartId, { now = new Date() } = {}, tenantId) {
    await db.transaction(async (trx) => {
        await trx.raw('SELECT set_config(?, ?, true)', ['app.current_tenant_id', tenantId]);

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
export async function isCheckoutInProgress(cartId, sessionId, trx = db) {
    if(!isSessionId(sessionId)) {
        return false;
    }

    const session = await StripeService.retrieveCheckoutSession(sessionId);

    if(session.status === 'expired') {
        await clearSession(cartId, sessionId, trx);
        return false;
    }

    return true;
}


/**
 * Abandons an open checkout so the cart can be edited again.
 *
 * @returns {Promise<{ status: 'cancelled' | 'none' | 'complete' }>}
 */
export async function cancelCheckout(cartId, trx = db) {
    const cart = await trx('carts').where({ id: cartId }).whereNull('deleted_at').first('stripe_order_id', 'tenant_id');
    const sessionId = cart?.stripe_order_id;

    if(!isSessionId(sessionId)) {
        await releaseCheckoutHold(cartId, trx, cart?.tenant_id);
        return { status: 'none' };
    }

    const session = await StripeService.retrieveCheckoutSession(sessionId);

    if(session.status === 'complete') {
        return { status: 'complete' };
    }

    if(session.status === 'open') {
        await StripeService.expireCheckoutSession(sessionId);
    }

    await clearSession(cartId, sessionId, trx);
    await touchServiceActivity(cart?.tenant_id, trx);

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
 * Creates a Stripe embedded Checkout Session for a cart — the client mounts Stripe's payment
 * form into the page itself using the returned client_secret, rather than being redirected to
 * a Stripe-hosted page.
 *
 * Line items are built from the current product prices in the database,
 * never from anything the client sends or from the price snapshot stored on
 * the cart item.
 *
 * @returns {Promise<{ client_secret: string }>}
 */
const itemUnavailable = (productId, title) => {
    return Boom.conflict(`"${title || 'An item'}" is no longer available`, {
        code: 'item_unavailable',
        product_id: productId || null,
        title: title || null
    });
};

export function createCheckoutForCart(cartId, trx) {
    return createCheckout(cartId, trx);
}

async function createCheckout(cartId, trx = db) {
    // Serializes checkout creation per cart so two simultaneous requests can never both create
    // a payable session for it — a Postgres transaction-scoped advisory lock on `trx` (the
    // ambient request transaction opened in serverExtensions' onPreHandler and committed/rolled
    // back in its onPreResponse, which already wraps this entire function including the Stripe
    // call below), not an in-process mutex: it works across every server instance, and is
    // released automatically on that transaction's commit OR rollback, so a thrown error or a
    // crash can never leave it held. hashtextextended hashes the cart's UUID down to the bigint
    // key pg_advisory_xact_lock needs; a hash collision between two different carts would only
    // ever serialize their checkouts against each other, never produce incorrect behavior.
    await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [cartId]);

    const cart = await CartSvc.fetchOne({ where: { id: cartId }, trx });

    if(!cart || cart.closed_at) {
        throw Boom.conflict('Cart is not available for checkout');
    }

    const cartItems = (cart.cart_items || []).filter((item) => item.qty > 0);
    if(!cartItems.length) {
        throw Boom.badRequest('Cart is empty');
    }

    // Product ids offered by the service's current published menu (FR-008a)
    let offeredIds = null;
    if(cart.service_id) {
        const offered = await trx('service as s')
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
        const product = await ProductSvc.fetchOne({ where: { id: item.product?.id }, trx });

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
            throw Boom.conflict(`"${product.title}" has no price`, { code: 'item_unavailable', product_id: product.id, title: product.title });
        }
    }

    // Only one live session per cart, otherwise a customer could pay twice
    if(isSessionId(cart.stripe_order_id)) {
        const previous = await StripeService.retrieveCheckoutSession(cart.stripe_order_id);

        if(previous.status === 'complete') {
            throw Boom.conflict('A payment for this cart is already being processed');
        }

        // Pay pressed twice, or Continue to payment: hand back the same session — confirmed
        // empirically that client_secret survives a retrieve, not just the original create
        if(previous.status === 'open' && previous.client_secret) {
            return { client_secret: previous.client_secret };
        }

        if(previous.status === 'open') {
            await StripeService.expireCheckoutSession(previous.id);
        }
    }

    const storefrontUrl = getStorefrontUrl();

    // reserveCheckoutStock deliberately opens its own short transaction (see its own comment)
    // rather than using this request's ambient `trx`. A plain targeted read, not
    // CartSvc.fetchOne — tenant_id isn't in CartModel's Joi schema (deliberately: that schema
    // also drives what a client payload may set, and tenant_id must never be client-settable).
    const { tenant_id: cartTenantId } = await trx('carts').where({ id: cart.id }).first('tenant_id');
    await reserveCheckoutStock(cart.id, {}, cartTenantId);
    await touchServiceActivity(cartTenantId, trx);

    let session;

    try {
        session = await StripeService.createEmbeddedCheckoutSession({
            lineItems,
            returnUrl: `${storefrontUrl}/order/complete?session_id={CHECKOUT_SESSION_ID}`,
            clientReferenceId: cart.id,
            metadata: { cart_id: cart.id },
            automaticTax: process.env.STRIPE_AUTOMATIC_TAX === 'true',
        });
    }
    catch(err) {
        await releaseCheckoutHold(cart.id, trx, cartTenantId);
        throw err;
    }

    // The hold outlasts the session so a customer can never pay after it is released
    const holdUntil = session.expires_at
        ? new Date(session.expires_at * 1000 + HOLD_MARGIN_MS)
        : new Date(Date.now() + PROVISIONAL_HOLD_MS + HOLD_MARGIN_MS);

    await trx('carts').where({ id: cart.id }).update({
        stripe_order_id: session.id,
        checkout_expires_at: holdUntil,
        updated_at: trx.fn.now()
    });

    return { client_secret: session.client_secret };
}


/**
 * Completes a cart from a verified checkout.session.completed event.
 * Safe to call repeatedly: Stripe retries webhooks.
 *
 * Unlike every other function in this file, there is no ambient request-scoped transaction
 * here — this runs from the Stripe webhook route (`auth: false`, authenticated by Stripe's
 * signature, not a tenant-bearing session), so no tenant context exists yet when this is
 * called. `get_cart_tenant_id()` (a narrow SECURITY DEFINER function, see migration
 * 96_multi_tenant_foundation.js) resolves it, then everything else proceeds inside a normal
 * tenant-scoped transaction like any other request.
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

    const { rows } = await db.raw('SELECT get_cart_tenant_id(?) AS tenant_id', [cartId]);
    const tenantId = rows[0]?.tenant_id;

    if(!tenantId) {
        global.logger.error('Checkout: paid session for a cart that does not exist', {
            meta: { session_id: session.id, cart_id: cartId }
        });
        return { handled: false };
    }

    const result = await db.transaction(async (trx) => {
        await trx.raw('SELECT set_config(?, ?, true)', ['app.current_tenant_id', tenantId]);

        // Found by independent QA review: onPreHandler's suspended-tenant check (T035) only
        // runs for requests that go through it, and this webhook deliberately doesn't (no
        // ambient auth/trx exists for Stripe's callback — see this function's own comment
        // above). Checked here too so a tenant suspended after a customer already reached
        // Stripe's hosted Checkout page doesn't still get a completed order recorded. The
        // payment itself was already authorized by Stripe by this point either way — this
        // can't un-charge the customer — so this only controls whether OUR record of it
        // completes, not whether money moved.
        const tenant = await trx('tenants').where({ id: tenantId }).first('status', 'name', 'timezone');

        if(tenant?.status === 'suspended') {
            global.logger.error('Checkout: paid session for a suspended tenant, not completing', {
                meta: { session_id: session.id, cart_id: cartId, tenant_id: tenantId }
            });
            return { handled: false };
        }

        const cart = await trx('carts').where({ id: cartId }).whereNull('deleted_at').first();

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
        const salesTax = session.total_details?.amount_tax ?? 0;
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
            billing_email: details.email || null,
        };

        const serverCart = await CartSvc.fetchOne({ where: { id: cartId }, trx });

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

        const { code: pickupCode, date: pickupCodeDate } = await allocatePickupCode(tenantId, tenant.timezone, trx);

        await trx('carts').where({ id: cartId }).whereNull('closed_at').update({
            ...billing,
            sales_tax: salesTax,
            currency: session.currency || cart.currency,
            stripe_payment_intent_id: typeof session.payment_intent === 'string'
                ? session.payment_intent
                : session.payment_intent?.id || null,
            stripe_order_id: session.id,
            pickup_code: pickupCode,
            pickup_code_date: pickupCodeDate,
            closed_at: trx.fn.now(),
            // Kitchen Display System: a cart only becomes a kitchen "ticket" once paid, set
            // here alongside closed_at/pickup_code rather than defaulted at the column level
            // (20261102120000_kitchen_status.js) — kitchen_status IS NOT NULL is the kanban
            // board's own filter, so historical pre-feature carts are correctly left out of it.
            kitchen_status: 'queued',
            kitchen_status_updated_at: trx.fn.now(),
            updated_at: trx.fn.now()
        });

        await touchServiceActivity(tenantId, trx);

        // Gathered here, inside the transaction, so the actual Postmark call below can happen
        // entirely after commit without any further tenant-scoped reads (RLS tenant context is
        // transaction-local — see set_config's `true` third arg above — so it's gone once this
        // transaction ends).
        return {
            handled: true,
            cartId,
            receipt: billing.billing_email ? {
                tenantName: tenant.name,
                billingEmail: billing.billing_email,
                pickupCode,
                currency: session.currency || cart.currency,
                items: (serverCart?.cart_items || []).map((item) => ({
                    name: item.product?.title || 'Item',
                    quantity: item.qty,
                    price: item.price_subtotal || 0
                })),
                subtotal: serverCart?.price_subtotal || 0,
                tax: salesTax,
                total: (serverCart?.price_subtotal || 0) + salesTax
            } : null
        };
    });

    if(result.receipt) {
        try {
            await sendReceiptEmail(result.receipt);
        }
        catch(err) {
            // The order is already recorded — a failed receipt email must not fail the
            // webhook ack (Stripe would otherwise retry the whole event, re-running completion
            // logic that already succeeded) or undo the completed order.
            global.logger.error(err, { meta: { session_id: session.id, cart_id: result.cartId } });
        }
    }

    return result;
}
