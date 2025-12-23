import Joi from 'joi';
import BaseController from '../base/BaseController.js';
import CartService from './CartService.js';
import CartItemService from './CartItemService.js';

export default class CartController extends BaseController {

    constructor() {
        super(new CartService());
        this.CartItemService = new CartItemService();
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

    getAdminNotesSchema() {
        return {
            admin_order_notes: Joi.alternatives().try(Joi.array(), Joi.string().empty(''), Joi.allow(null)),
        }
    }

}
