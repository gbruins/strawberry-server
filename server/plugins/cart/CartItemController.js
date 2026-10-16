import Boom from '@hapi/boom';
import BaseController from '../base/BaseController.js';
import CartItemService from './CartItemService.js';

export default class CartItemController extends BaseController {

    constructor() {
        super(new CartItemService());
    }

    async createHandler(request, h) {
        try {
            global.logger.info('REQUEST: CartItemController.createHandler', {
                meta: request.payload
            });

            const Cart = await this.service.createCartItem(request.payload);

            global.logger.info('RESPONSE: CartItemController.createHandler', {
                meta: Cart
            });

            return h.apiSuccess(Cart);
        }
        catch(err) {
            if(err.isBoom) {
                throw err;
            }

            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }


    async updateHandler(request, h) {
        try {
            global.logger.info(`REQUEST: CartItemController.updateHandler`, {
                meta: request.payload
            });

            const Cart = await this.service.updateCartItem(request.payload.id, request.payload.qty);

            global.logger.info('RESPONSE: CartItemController.updateHandler', {
                meta: Cart
            });

            return h.apiSuccess(Cart);
        }
        catch(err) {
            if(err.isBoom) {
                throw err;
            }

            global.logger.error(err);
            global.bugsnag(err);
            throw Boom.badRequest(err);
        }
    }

}
