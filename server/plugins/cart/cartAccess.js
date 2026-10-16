import Boom from '@hapi/boom';
import db from '../../db/knex.js';
import CartService from './CartService.js';

export const CART_TOKEN_HEADER = 'x-cart-token';

const CartSvc = new CartService();

/**
 * Builds a route `pre` method that restricts store (API key) callers to the
 * cart identified by their X-Cart-Token header. Admin sessions are not
 * restricted.
 *
 * @param {Function} getCartId  (request) => cart id, or a promise of it
 * @param {Object} [opts]
 * @param {boolean} [opts.mutates] when true, store callers can't modify closed carts
 */
export function requireCartAccess(getCartId, { mutates = false } = {}) {
    return async (request, h) => {
        if(request.auth.strategy === 'adminCookie') {
            return h.continue;
        }

        const cartId = await getCartId(request);

        if(!cartId) {
            throw Boom.badRequest('cart_id is required');
        }

        const { exists, valid, closed } = await CartSvc.checkToken(
            cartId,
            request.headers[CART_TOKEN_HEADER]
        );

        // Same response for a missing cart and a bad token so cart IDs can't be probed
        if(!exists || !valid) {
            throw Boom.notFound();
        }

        if(mutates && closed) {
            throw Boom.conflict('Cart is closed');
        }

        return h.continue;
    };
}


const isAdmin = (request) => request.auth.strategy === 'adminCookie';

/**
 * Store (API key) callers may only write the customer-supplied billing details.
 * Everything else (tax, currency, Stripe ids, closed/shipped state, admin notes)
 * is server- or admin-controlled.
 */
export function restrictStoreFields(request, h) {
    if(isAdmin(request)) {
        return h.continue;
    }

    const forbidden = Object.keys(request.payload || {})
        .filter((key) => key !== 'id' && !key.startsWith('billing_'));

    if(forbidden.length) {
        throw Boom.forbidden(`Fields not permitted: ${forbidden.join(', ')}`);
    }

    return h.continue;
}


const STORE_HIDDEN_FIELDS = ['admin_order_notes'];

/**
 * Route onPreResponse extension that removes admin-only fields from cart
 * responses sent to store (API key) callers.
 */
export function redactCartForStore(request, h) {
    const data = request.response?.source?.data;

    if(request.response?.isBoom || isAdmin(request) || !data || typeof data !== 'object') {
        return h.continue;
    }

    STORE_HIDDEN_FIELDS.forEach((field) => {
        if(Array.isArray(data)) {
            data.forEach((row) => delete row[field]);
        }
        else {
            delete data[field];
        }
    });

    return h.continue;
}


export async function getCartIdForItem(itemId) {
    const row = await db
        .select('cart_id')
        .from('cart_items')
        .where({ id: itemId })
        .whereNull('deleted_at')
        .first();

    return row?.cart_id;
}
