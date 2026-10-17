import Joi from 'joi';
import Boom from '@hapi/boom';
import BaseController from '../base/BaseController.js';
import CartService from './CartService.js';
import CartItemService from './CartItemService.js';
import { createCheckoutForCart, cancelCheckout, isCheckoutInProgress } from './CheckoutService.js';

export default class CartController extends BaseController {

    constructor() {
        super(new CartService());
        this.CartItemService = new CartItemService();
    }

    async getByIdHandler(request, h) {
        try {
            const cart = await this.service.fetchOne({ where: { id: request.query.id } });

            if(cart) {
                cart.checkout_in_progress = await this.isLocked(cart);
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
    async isLocked(cart) {
        if(cart.closed_at || !cart.stripe_order_id) {
            return false;
        }

        try {
            return await isCheckoutInProgress(cart.id, cart.stripe_order_id);
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

            const cart = await this.service.createWithToken(request.payload);

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
                where: { id: request.payload.id }
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

            const checkout = await createCheckoutForCart(request.payload.id);

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

            return h.apiSuccess(await cancelCheckout(request.payload.id));
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err.message);
        }
    }

    getAdminNotesSchema() {
        return {
            admin_order_notes: Joi.alternatives().try(Joi.array(), Joi.string().empty(''), Joi.allow(null)),
        }
    }

}
