import Joi from 'joi';
import ServiceMenuController from './ServiceMenuController.js';
import {
    getGenericConfig_SEARCH,
    getGenericConfig_GET,
    getGenericConfig_POST,
    getGenericConfig_PUT,
    getGenericConfig_DELETE } from '../../utils/routeUtils.js';

export const serviceMenuPlugin = {
    name: 'serviceMenuPlugin',
    version: '1.0.0',
    register: async function (server, options) {
        const Ctrl = new ServiceMenuController();

        server.route([
            getGenericConfig_SEARCH(Ctrl, {
                path: '/service_menus',
                options: {
                    auth: {
                        strategies: ['apiKey', 'adminCookie']
                    },
                }
            }),

            getGenericConfig_GET(Ctrl, {
                path: '/service_menu',
                options: {
                    auth: {
                        strategies: ['apiKey', 'adminCookie']
                    },
                }
            }),

            {
                method: 'GET',
                path: '/service_menu/products',
                handler: (request, h) => Ctrl.getProductsHandler(request, h),
                options: {
                    description: 'Gets the products on a menu in display order',
                    auth: { strategies: ['apiKey', 'adminCookie'] },
                    validate: { query: ServiceMenuController.idQuery }
                }
            },

            {
                method: 'PUT',
                path: '/service_menu/products',
                handler: (request, h) => Ctrl.setProductsHandler(request, h),
                options: {
                    description: 'Replaces the products on a menu and their order',
                    validate: {
                        query: ServiceMenuController.idQuery,
                        payload: Joi.object({
                            product_ids: Joi.array().items(Joi.string().uuid()).required()
                        })
                    }
                }
            },

            {
                method: 'GET',
                path: '/service_menu/usage',
                handler: (request, h) => Ctrl.usageHandler(request, h),
                options: {
                    description: 'Open or upcoming services that use a menu',
                    validate: { query: ServiceMenuController.idQuery }
                }
            },

            getGenericConfig_POST(Ctrl, {
                path: '/service_menu'
            }),

            getGenericConfig_PUT(Ctrl, {
                path: '/service_menu'
            }),

            getGenericConfig_DELETE(Ctrl, {
                path: '/service_menu'
            })
        ]);
    }
};


