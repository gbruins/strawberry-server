import Boom from '@hapi/boom';
import StripeService from './StripeService.js';
import { completeCartFromSession } from '../cart/CheckoutService.js';

export default class StripeController {

    constructor() {
        this.service = StripeService
    }


    async getStripeTaxCodesHandler(request, h) {
        try {
            global.logger.info(`REQUEST: StripeController.getStripeTaxCodesHandler`, {
                meta: request.query
            });

            const response = await this.service.getTaxCodes(request.query);

            // global.logger.info(`RESPONSE: StripeController.getStripeTaxCodesHandler`, {
            //     meta: response
            // });

            return h.apiSuccess(response);
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }


    async getStripeTaxCodeHandler(request, h) {
        try {
            global.logger.info(`REQUEST: StripeController.getStripeTaxCodeHandler`, {
                meta: request.query
            });

            const response = await this.service.getTaxCode(request.query.id);

            global.logger.info(`RESPONSE: StripeController.getStripeTaxCodeHandler`, {
                meta: response
            });

            return h.apiSuccess(response);
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }


    async getStripePricesHandler(request, h) {
        try {
            global.logger.info(`REQUEST: StripeController.getStripePricesHandler`, {
                meta: request.query
            });

            const response = await this.service.findPricesByAmount({
                unitAmount: request.query.amount,
                productId: request.query.productId
            });

            global.logger.info(`RESPONSE: StripeController.getStripePricesHandler`, {
                meta: response
            });

            return h.apiSuccess(response);
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }


    async createStripePriceHandler(request, h) {
        try {
            global.logger.info(`REQUEST: StripeController.createStripePricesHandler`, {
                meta: request.query
            });

            const response = await this.service.createPrice(request.payload);

            global.logger.info(`RESPONSE: StripeController.createStripePricesHandler`, {
                meta: response
            });

            return h.apiSuccess(response);
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }


    async webhookHandler(request, h) {
        let event;

        try {
            event = this.service.verifyWebhookEvent(
                request.payload,
                request.headers['stripe-signature']
            );
        }
        catch(err) {
            throw Boom.badRequest('Invalid signature');
        }

        try {
            global.logger.info('REQUEST: StripeController.webhookHandler', {
                meta: { id: event.id, type: event.type }
            });

            switch(event.type) {
                case 'checkout.session.completed':
                    await completeCartFromSession(event.data.object);
                    break;
            }

            return h.response({ received: true });
        }
        catch(err) {
            global.logger.error(err);
            // A 5xx makes Stripe retry the event
            throw Boom.internal();
        }
    }

}
