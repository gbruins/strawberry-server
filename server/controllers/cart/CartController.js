import Boom from '@hapi/boom';
import BaseController from '../BaseController.js';
import CartService from '../../services/cart/CartService.js';

export default class CartController extends BaseController {

    constructor() {
        super(new CartService());
    }


    /**
     * Gets an order (a closed cart) and the related ShipEngine label data
     *
     * @param {*} request
     * @param {*} h
     * @returns {}
     */
    async getOrderHandler(request, h) {
        try {
            global.logger.info('REQUEST: CartController.getOrderHandler', {
                meta: request.query
            });

            const Order = await this.service.getOrder(request.query.id)

            global.logger.info('RESPONSE: CartController.getOrderHandler', {
                meta: Order
            });

            return h.apiSuccess(Order);
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }


    async resendOrderConfirmaionHandler(request, h) {
        try {
            global.logger.info('REQUEST: CartController.resendOrderConfirmaionHandler', {
                meta: request.payload
            });

            const response = await this.service.sendPurchaseReceiptToBuyer(request.payload.id);

            global.logger.info('RESPONSE: CartController.resendOrderConfirmaionHandler', {
                meta: response
            });

            return h.apiSuccess(response);
        }
        catch(err) {
            global.logger.error(err);
        }
    }


    async getPaymentHandler(request, h) {
        try {
            global.logger.info('REQUEST: CartController.getPaymentHandler', {
                meta: request.payload
            });

            const paymentData = await this.service.getOrder(
                request.query.id
            );

            global.logger.info('RESPONSE: CartController.getPaymentHandler', {
                meta: paymentData.payment
            });

            return h.apiSuccess(paymentData.payment);
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }


    async submitStripeOrderForCartHandler(request, h) {
        try {
            global.logger.info('REQUEST: CartController.submitStripeOrderForCartHandler', {
                meta: request.payload
            });

            const submittedOrder = await this.service.submitStripeOrderForCart(request.payload.id)

            global.logger.info('RESPONSE: CartController.submitStripeOrderForCartHandler - Stripe resposne', {
                meta: {
                    submittedOrder
                }
            });

            return h.apiSuccess({
                clientSecret: submittedOrder.payment.payment_intent.client_secret
            });
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }


    async paymentSuccessHandler(request, h) {
        try {
            global.logger.info('REQUEST: CartCtrl.paymentSuccessHandler', {
                meta: request.payload
            });

            await this.service.onPaymentSuccess(
                request.payload.id,
                request.payload.stripe_payment_intent_id
            )

            global.logger.info('RESPONSE: CartCtrl.onPaymentSuccess', {
                meta: {}
            });

            return h.apiSuccess();
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }
}
