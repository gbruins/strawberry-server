import ProductController from './ProductController.js';
import {
    getGenericConfig_SEARCH,
    getGenericConfig_GET,
    getGenericConfig_POST,
    getGenericConfig_PUT,
    getGenericConfig_DELETE } from '../../utils/routeUtils.js';

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

            getGenericConfig_POST(Ctrl, {
                path: '/product',
                options: {
                    description: 'Adds a new product'
                }
            }),

            getGenericConfig_PUT(Ctrl, {
                path: '/product',
                options: {
                    description: 'Updates a product'
                }
            }),

            getGenericConfig_DELETE(Ctrl, {
                path: '/product',
                options: {
                    description: 'Deletes a product'
                }
            })
        ]);
    }
};
