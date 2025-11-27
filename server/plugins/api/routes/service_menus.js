import ServiceMenuController from '../../../controllers/ServiceMenuController.js';
import {
    getGenericConfig_SEARCH,
    getGenericConfig_GET,
    getGenericConfig_POST,
    getGenericConfig_PUT,
    getGenericConfig_DELETE } from './utils/routeUtils.js';

const Ctrl = new ServiceMenuController();

export default (server) => {
    server.route([
        getGenericConfig_SEARCH(Ctrl, {
            path: '/service_menus',
            options: {
                // auth: {
                //     strategies: ['storeauth', 'adminCookie']
                // },
            }
        }),

        getGenericConfig_GET(Ctrl, {
            path: '/service_menu',
            options: {
                // auth: {
                //     strategies: ['storeauth', 'adminCookie']
                // },
            }
        }),

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
