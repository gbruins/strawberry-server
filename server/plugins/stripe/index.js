import Joi from 'joi';
import StripeController from './StripeController.js';

export const stripePlugin = {
    name: 'stripePlugin',
    version: '1.0.0',
    register: async function (server, options) {
        const Ctrl = new StripeController();

        server.route([
            {
                method: 'GET',
                path: '/stripe/tax_codes',
                options: {
                    description: 'Gets a list of Stripe tax codes',
                    auth: {
                        strategies: ['apiKey', 'adminCookie']
                    },
                    handler: (request, h) => {
                        return Ctrl.getStripeTaxCodesHandler(request, h);
                    }
                }
            },
            {
                method: 'GET',
                path: '/stripe/tax_code',
                options: {
                    description: 'Gets a single Stripe tax code by ID',
                    auth: {
                        strategies: ['apiKey', 'adminCookie']
                    },
                    validate: {
                        query: Joi.object({
                            id: Joi.string().required()
                        })
                    },
                    handler: (request, h) => {
                        return Ctrl.getStripeTaxCodeHandler(request, h);
                    }
                }
            },
            {
                method: 'GET',
                path: '/stripe/prices',
                options: {
                    description: 'Gets a list of Stripe prices',
                    auth: {
                        strategies: ['apiKey', 'adminCookie']
                    },
                    validate: {
                        query: Joi.object({
                            amount: Joi.number().integer().allow(null),
                            productId: Joi.string().uuid().allow(null)
                        })
                    },
                    handler: (request, h) => {
                        return Ctrl.getStripePricesHandler(request, h);
                    }
                }
            },
            {
                method: 'POST',
                path: '/stripe/webhook',
                options: {
                    description: 'Receives Stripe webhook events (authenticated by Stripe signature)',
                    auth: false,
                    payload: {
                        // The signature is computed over the raw body
                        parse: false,
                        output: 'data'
                    },
                    plugins: {
                        'hapi-rate-limit': { enabled: false }
                    },
                    handler: (request, h) => {
                        return Ctrl.webhookHandler(request, h);
                    }
                }
            },
            {
                method: 'POST',
                path: '/stripe/price',
                options: {
                    description: 'Adds a Stripe price',
                    auth: {
                        strategies: ['adminCookie']
                    },
                    handler: (request, h) => {
                        return Ctrl.createStripePriceHandler(request, h);
                    }
                }
            },
        ]);
    }
}
