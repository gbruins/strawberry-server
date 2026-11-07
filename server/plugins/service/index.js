import Joi from 'joi';
import ServiceController from './ServiceController.js';
import {
    getGenericConfig_SEARCH,
    getGenericConfig_GET,
    getGenericConfig_POST,
    getGenericConfig_PUT,
    getGenericConfig_DELETE } from '../../utils/routeUtils.js';

export const servicePlugin = {
    name: 'servicePlugin',
    version: '1.0.0',
    register: async function (server, options) {
        const Ctrl = new ServiceController();

        server.route([
            {
                method: 'GET',
                path: '/services/next',
                handler: (request, h) => Ctrl.nextHandler(request, h),
                options: {
                    description: 'Gets the current or next service state',
                    auth: {
                        strategies: ['apiKey', 'adminBearer']
                    }
                }
            },

            {
                method: 'POST',
                path: '/services/next/realtime-token',
                handler: (request, h) => Ctrl.realtimeTokenHandler(request, h),
                options: {
                    description: 'Mints a short-lived Supabase Realtime token for the storefront',
                    auth: {
                        strategies: ['apiKey', 'adminBearer']
                    }
                }
            },

            getGenericConfig_SEARCH(Ctrl, {
                path: '/services',
                options: {
                    description: 'Gets a list of services',
                    auth: {
                        strategies: ['adminBearer']
                    },
                }
            }),

            getGenericConfig_GET(Ctrl, {
                path: '/service',
                options: {
                    description: 'Gets a service by ID',
                    auth: {
                        strategies: ['adminBearer']
                    },
                }
            }),

            getGenericConfig_POST(Ctrl, {
                path: '/service',
                options: {
                    description: 'Adds a new service'
                }
            }),

            getGenericConfig_PUT(Ctrl, {
                path: '/service',
                options: {
                    description: 'Updates a service'
                }
            }),

            getGenericConfig_DELETE(Ctrl, {
                path: '/service',
                options: {
                    description: 'Deletes a service'
                }
            }),

            {
                method: 'GET',
                path: '/service/availability',
                handler: (request, h) => Ctrl.getAvailabilityHandler(request, h),
                options: {
                    description: 'Gets the service\'s menu products and whether each is in stock for this service',
                    auth: {
                        strategies: ['adminBearer']
                    },
                    validate: {
                        query: Joi.object({ id: Joi.string().uuid().required() })
                    }
                }
            },

            {
                method: 'PUT',
                path: '/service/availability',
                handler: (request, h) => Ctrl.setAvailabilityHandler(request, h),
                options: {
                    description: 'Sets which menu products are out of stock for this service',
                    auth: {
                        strategies: ['adminBearer']
                    },
                    validate: {
                        payload: Joi.object({
                            id: Joi.string().uuid().required(),
                            unavailable_product_ids: Joi.array().items(Joi.string().uuid()).required()
                        })
                    }
                }
            }
        ]);
    }
};
