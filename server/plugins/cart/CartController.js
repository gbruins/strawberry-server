import Joi from 'joi';
import Boom from '@hapi/boom';
import BaseController from '../base/BaseController.js';
import CartService from './CartService.js';
import CartItemService from './CartItemService.js';
import { createCheckoutForCart, cancelCheckout } from './CheckoutService.js';

export default class CartController extends BaseController {

    constructor() {
        super(new CartService());
        this.CartItemService = new CartItemService();
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
