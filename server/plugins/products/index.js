import Joi from 'joi';
import ProductController from './ProductController.js';
import {
    getGenericConfig_SEARCH,
    getGenericConfig_GET
} from '../../utils/routeUtils.js';

export const productPlugin = {
    name: 'productPlugin',
    version: '1.0.0',
    register: async function (server, options) {
        const Ctrl = new ProductController();

        server.route([
            getGenericConfig_SEARCH(Ctrl, {
                path: '/products',
                options: {
                    description: 'Gets a list of products'
                },
            }),

            getGenericConfig_GET(Ctrl, {
                path: '/product',
                options: {
                    description: 'Gets a product by ID'
                }
            }),

            {
                method: 'POST',
                path: '/product',
                options: {
                    description: 'Adds a new product',
                    validate: {
                        payload: Joi.object({
                            ...Ctrl.service.getValidationSchemaForAdd()
                        })
                    },
                    handler: (request, h) => {
                        return Ctrl.createHandler(request, h);
                    }
                }
            },

            {
                method: 'PUT',
                path: '/product',
                options: {
                    description: 'Updates a product',
                    validate: {
                        payload: Joi.object({
                            ...Ctrl.service.getValidationSchemaForUpdate()
                        })
                    },
                    handler: (request, h) => {
                        return Ctrl.updateHandler(request, h);
                    }
                }
            },

            {
                method: 'DELETE',
                path: '/product',
                options: {
                    description: 'Deletes a product',
                    validate: {
                        query: Joi.object({
                            ...Ctrl.service.getValidationSchemaForId()
                        })
                    },
                    handler: (request, h) => {
                        return Ctrl.deleteHandler(request, h);
                    }
                }
            }
        ]);
    }
};
