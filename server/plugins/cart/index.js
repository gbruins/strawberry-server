import Joi from 'joi';
import CartController from './CartController.js';
import CartItemController from './CartItemController.js';
import {
    getGenericConfig_SEARCH,
    getGenericConfig_GET,
    getGenericConfig_POST,
    getGenericConfig_PUT,
    getGenericConfig_DELETE
 } from '../../utils/routeUtils.js';

export const cartPlugin = {
    name: 'cartPlugin',
    version: '1.0.0',
    register: async function (server, options) {
        const Ctrl = new CartController();
        const CartItemCtrl = new CartItemController();

        server.route([
            getGenericConfig_SEARCH(Ctrl, {
                path: '/carts',
                options: {
                    description: 'Gets a list of carts',
                    auth: {
                        // App should not be able to see other carts
                    }
                }
            }),

            getGenericConfig_GET(Ctrl, {
                path: '/cart',
                options: {
                    description: 'Gets a cart by ID',
                    auth: {
                        strategies: ['adminCookie', 'apiKey']
                    }
                }
            }),

            getGenericConfig_POST(Ctrl, {
                path: '/cart',
                options: {
                    description: 'Adds a new cart',
                    auth: {
                        strategies: ['adminCookie', 'apiKey']
                    }
                }
            }),

            getGenericConfig_PUT(Ctrl, {
                path: '/cart',
                options: {
                    description: 'Updates a cart',
                    auth: {
                        strategies: ['adminCookie', 'apiKey']
                    }
                }
            }),

            getGenericConfig_DELETE(Ctrl, {
                path: '/cart',
                options: {
                    description: 'Deletes a cart',
                    auth: {
                        // App should not be able to delete carts
                        strategies: ['adminCookie', 'apiKey']
                    }
                }
            }),

            {
                method: 'PUT',
                path: '/cart/notes',
                options: {
                    description: 'Updates the admin notes for a cart',
                    auth: {
                        strategies: ['adminCookie']
                    },
                    validate: {
                        payload: Joi.object({
                            ...Ctrl.getIdSchema(),
                            ...Ctrl.getAdminNotesSchema(),
                        })
                    },
                    handler: (request, h) => {
                        return Ctrl.updateOrderNotesHandler(request, h);
                    }
                }
            },

            // CART ITEMS
            {
                method: 'POST',
                path: '/cart/item',
                options: {
                    description: 'Adds an item to Cart',
                    auth: {
                        strategies: ['adminCookie', 'apiKey']
                    },
                    validate: {
                        payload: Joi.object({
                            ...CartItemCtrl.service.getValidationSchemaForAdd()
                        })
                    },
                    handler: (request, h) => {
                        return CartItemCtrl.createHandler(request, h);
                    }
                }
            },
            {
                method: 'PUT',
                path: '/cart/item',
                options: {
                    description: 'Updates a CartItem',
                    auth: {
                        strategies: ['adminCookie', 'apiKey']
                    },
                    validate: {
                        payload: Joi.object({
                            ...CartItemCtrl.service.getValidationSchemaForUpdate()
                        })
                    },
                    handler: (request, h) => {
                        return CartItemCtrl.updateHandler(request, h);
                    }
                }
            },
            {
                method: 'DELETE',
                path: '/cart/item',
                options: {
                    description: 'Deletes a CartItem',
                    auth: {
                        strategies: ['adminCookie', 'apiKey']
                    },
                    validate: {
                        query: Joi.object({
                            ...CartItemCtrl.service.getValidationSchemaForId()
                        })
                    },
                    handler: (request, h) => {
                        return CartItemCtrl.deleteHandler(request, h);
                    }
                }
            },
        ]);
    }
}


