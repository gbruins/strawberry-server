import AddressDiscountController from './AddressDiscountController.js';
import {
    getGenericConfig_SEARCH,
    getGenericConfig_GET,
    getGenericConfig_POST,
    getGenericConfig_PUT,
    getGenericConfig_DELETE } from '../../utils/routeUtils.js';

export const addressDiscountPlugin = {
    name: 'addressDiscountPlugin',
    version: '1.0.0',
    register: async function (server, options) {
        const Ctrl = new AddressDiscountController();

        server.route([
            getGenericConfig_SEARCH(Ctrl, {
                path: '/address_discounts',
                options: {
                    // auth: {
                    //     strategies: ['storeauth', 'adminCookie']
                    // },
                }
            }),

            getGenericConfig_GET(Ctrl, {
                path: '/address_discount',
                options: {
                    // auth: {
                    //     strategies: ['storeauth', 'adminCookie']
                    // },
                }
            }),

            getGenericConfig_POST(Ctrl, {
                path: '/address_discount'
            }),

            getGenericConfig_PUT(Ctrl, {
                path: '/address_discount'
            }),

            getGenericConfig_DELETE(Ctrl, {
                path: '/address_discount'
            })
        ]);
    }
}
