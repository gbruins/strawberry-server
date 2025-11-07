import ProductController from '../../../controllers/ProductController.js';
import {
    getGenericConfig_SEARCH,
    getGenericConfig_GET,
    getGenericConfig_POST,
    getGenericConfig_PUT,
    getGenericConfig_DELETE } from './utils/routeUtils.js';

const Ctrl = new ProductController();

export default (server) => {
    server.route([
        getGenericConfig_SEARCH(Ctrl, {
            path: '/products',
            options: {
                description: 'Gets a list of products',
                // auth: {
                //     strategies: ['storeauth', 'session']
                // },
            }
        }),

        getGenericConfig_GET(Ctrl, {
            path: '/product',
            options: {
                description: 'Gets a product by ID',
                // auth: {
                //     strategies: ['storeauth', 'session']
                // },
            }
        }),

        getGenericConfig_POST(Ctrl, {
            path: '/product',
            options: {
                description: 'Adds a new product',
                // auth: {
                //     strategies: ['session']
                // }
            }
        }),

        getGenericConfig_PUT(Ctrl, {
            path: '/product',
            options: {
                description: 'Updates a product',
                // auth: {
                //     strategies: ['session']
                // }
            }
        }),

        getGenericConfig_DELETE(Ctrl, {
            path: '/product',
            options: {
                description: 'Deletes a product',
                // auth: {
                //     strategies: ['session']
                // },
            }
        })
    ]);
}
