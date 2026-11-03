import Joi from 'joi';
import Boom from '@hapi/boom';
import BaseController from '../base/BaseController.js';
import CartService from './CartService.js';
import CartItemService from './CartItemService.js';
import { createCheckoutForCart, cancelCheckout, isCheckoutInProgress } from './CheckoutService.js';
import { sendOrderReadyEmail } from '../notifications/NotificationService.js';

// Kitchen Display System: adjacent-step moves either direction (a shared touchscreen mis-tap
// should be fixable by tapping the previous column), but never a skip-ahead straight to
// 'completed' — that's a near-certain mis-tap, not an intentional move, and skipping it would
// also bypass ever having been 'in_progress'. `from` must already be a ticket (not null/
// undefined) — a cart with no kitchen_status yet isn't a ticket at all.
const KITCHEN_STATUS_ORDER = ['queued', 'in_progress', 'completed'];

function isAdjacentKitchenTransition(from, to) {
    if (!from || !KITCHEN_STATUS_ORDER.includes(from) || !KITCHEN_STATUS_ORDER.includes(to)) {
        return false;
    }

    return Math.abs(KITCHEN_STATUS_ORDER.indexOf(from) - KITCHEN_STATUS_ORDER.indexOf(to)) === 1;
}

export default class CartController extends BaseController {

    constructor() {
        super(new CartService());
        this.CartItemService = new CartItemService();
    }

    async getByIdHandler(request, h) {
        try {
            const cart = await this.service.fetchOne({ where: { id: request.query.id }, trx: request.app.trx });

            if(cart) {
                cart.checkout_in_progress = await this.isLocked(cart, request.app.trx);
            }

            return h.apiSuccess(cart);
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }

    // True while the cart's Stripe session is live. The stock hold outlasts the session,
    // so checkout_expires_at alone would report a lock that edits no longer see.
    async isLocked(cart, trx) {
        if(cart.closed_at || !cart.stripe_order_id) {
            return false;
        }

        try {
            return await isCheckoutInProgress(cart.id, cart.stripe_order_id, trx);
        }
        catch(err) {
            global.logger.error(err);
            return !!cart.checkout_expires_at && new Date(cart.checkout_expires_at) > new Date();
        }
    }

    async createHandler(request, h) {
        try {
            // The response contains the one-time cart token, so it is deliberately not logged
            global.logger.info('REQUEST: CartController.createHandler', {
                meta: request.payload
            });

            const cart = await this.service.createWithToken(request.payload, request.app.trx, request.app.tenantId);

            return h.apiSuccess(cart);
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }


     /**
     * Handler for updating the admin notes of a cart
     *
     * @param {*} request
     * @param {*} h
     * @returns {*}
     */
    async updateOrderNotesHandler(request, h) {
        const req = { ...request };

        req.payload = {
            id: request.payload.id,
            admin_order_notes: request.payload.admin_order_notes
        };

        return super.updateHandler(req, h);
    }

    async updateCustomerNoteHandler(request, h) {
        try {
            const note = (request.payload.customer_note || '').trim();

            await this.service.update({
                data: { id: request.payload.id, customer_note: note || null },
                where: { id: request.payload.id },
                trx: request.app.trx
            });

            return this.getByIdHandler({ ...request, query: { id: request.payload.id } }, h);
        }
        catch(err) {
            if(err.isBoom) {
                throw err;
            }

            global.logger.error(err);
            throw Boom.badRequest(err.message);
        }
    }

    async checkoutHandler(request, h) {
        try {
            global.logger.info('REQUEST: CartController.checkoutHandler', {
                meta: { id: request.payload.id }
            });

            const checkout = await createCheckoutForCart(request.payload.id, request.app.trx);

            return h.apiSuccess(checkout);
        }
        catch(err) {
            if(err.isBoom) {
                throw err;
            }

            global.logger.error(err);
            throw Boom.badRequest(err.message);
        }
    }

    async cancelCheckoutHandler(request, h) {
        try {
            global.logger.info('REQUEST: CartController.cancelCheckoutHandler', {
                meta: { id: request.payload.id }
            });

            return h.apiSuccess(await cancelCheckout(request.payload.id, request.app.trx));
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err.message);
        }
    }

    async updateKitchenStatusHandler(request, h) {
        try {
            const { id, kitchen_status: nextStatus } = request.payload;
            const trx = request.app.trx;

            const cart = await trx('carts').where({ id }).whereNull('deleted_at').first(
                'id', 'tenant_id', 'kitchen_status', 'billing_email', 'pickup_code'
            );

            if (!cart) {
                throw Boom.notFound();
            }

            if (!isAdjacentKitchenTransition(cart.kitchen_status, nextStatus)) {
                throw Boom.badRequest(`Cannot move a ticket from "${cart.kitchen_status || 'none'}" to "${nextStatus}"`);
            }

            const [updated] = await trx('carts')
                .where({ id })
                .update({
                    kitchen_status: nextStatus,
                    kitchen_status_updated_at: trx.fn.now(),
                    updated_at: trx.fn.now()
                })
                .returning(['id', 'kitchen_status', 'kitchen_status_updated_at']);

            if (nextStatus === 'completed') {
                await this.sendOrderReadyEmailIfDue(cart, trx);
            }

            return h.apiSuccess(updated);
        }
        catch (err) {
            if (err.isBoom) {
                throw err;
            }

            global.logger.error(err);
            throw Boom.badRequest(err.message);
        }
    }


    /**
     * Gated on a conditional `UPDATE ... WHERE kitchen_ready_email_sent_at IS NULL` — the
     * idempotency guard this column exists for (20261102120000_kitchen_status.js). Two tablets
     * completing the same ticket near-simultaneously both reach this method, but only the one
     * whose UPDATE actually affects a row (wins the race) goes on to send the email; the other
     * sees zero rows returned and does nothing. Never cleared on a later status change, by
     * design — re-completing a ticket must not re-send the email.
     */
    async sendOrderReadyEmailIfDue(cart, trx) {
        if (!cart.billing_email) {
            global.logger.info('Kitchen: completed ticket has no billing_email, skipping order-ready email', {
                meta: { cartId: cart.id }
            });
            return;
        }

        const claimed = await trx('carts')
            .where({ id: cart.id })
            .whereNull('kitchen_ready_email_sent_at')
            .update({ kitchen_ready_email_sent_at: trx.fn.now() });

        if (!claimed) {
            return;
        }

        const tenant = await trx('tenants').where({ id: cart.tenant_id }).first(
            'name', 'address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code', 'address_phone'
        );

        try {
            await sendOrderReadyEmail({
                tenantName: tenant?.name,
                billingEmail: cart.billing_email,
                pickupCode: cart.pickup_code,
                tenantAddress: tenant || {}
            });
        }
        catch (err) {
            // The status transition already committed — a failed notification must not undo it
            // or fail this request (same reasoning as CheckoutService's receipt-email handling).
            global.logger.error(err, { meta: { cartId: cart.id } });
        }
    }


    getAdminNotesSchema() {
        return {
            admin_order_notes: Joi.alternatives().try(Joi.array(), Joi.string().empty(''), Joi.allow(null)),
        }
    }

}
