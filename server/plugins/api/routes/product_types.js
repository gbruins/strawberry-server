import Joi from 'joi';
import ProductTypeController from '../../../controllers/ProductTypeController.js';
import {
    getGenericConfig_SEARCH,
    getGenericConfig_GET,
    getGenericConfig_POST,
    getGenericConfig_PUT,
    getGenericConfig_DELETE } from './utils/routeUtils.js';

const Ctrl = new ProductTypeController();

export default (server) => {
    server.route([
        getGenericConfig_SEARCH(Ctrl, {
            path: '/product_types',
            options: {
                // auth: {
                //     strategies: ['storeauth', 'session']
                // },
            }
        }),

        getGenericConfig_GET(Ctrl, {
            path: '/product_type',
            options: {
                // auth: {
                //     strategies: ['storeauth', 'session']
                // },
            }
        }),

        getGenericConfig_POST(Ctrl, {
            path: '/product_type',
            options: {
                // auth: {
                //     strategies: ['session']
                // },
                handler: (request, h) => {
                    return Ctrl.addProductTypeHandler(request, h);
                }
            }
        }),

        getGenericConfig_PUT(Ctrl, {
            path: '/product_type',
            options: {
                // auth: {
                //     strategies: ['session']
                // },
                handler: (request, h) => {
                    return Ctrl.updateProductTypeHandler(request, h);
                }
            }
        }),

        getGenericConfig_DELETE(Ctrl, {
            path: '/product_type',
            options: {
                // auth: {
                //     strategies: ['session']
                // },
            }
        }),

        {
            method: 'PUT',
            path: '/product_types/ordinal',
            options: {
                description: 'Bulk update product type ordinals',
                // auth: {
                //     strategies: ['session']
                // },
                validate: {
                    payload: Joi.object({
                        ...Ctrl.service.getValidationSchemaForUpdateOrdinals()
                    }),
                    failAction: (request, h, err) => {
                        console.log('Validation error:', err.message);
                        // throw err; // rethrow to preserve default behavior
                    }
                },
                handler: (request, h) => {
                    return Ctrl.bulkUpdateOrdinalsHandler(request, h);
                }
            }
        }
    ]);
}
