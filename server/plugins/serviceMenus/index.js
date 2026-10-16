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


