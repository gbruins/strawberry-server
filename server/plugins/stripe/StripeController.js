import StripeService from './StripeService.js';

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

}
