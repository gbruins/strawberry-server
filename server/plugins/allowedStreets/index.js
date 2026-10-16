import AllowedStreetController from './AllowedStreetController.js';
import {
    getGenericConfig_SEARCH,
    getGenericConfig_GET,
    getGenericConfig_POST,
    getGenericConfig_PUT,
    getGenericConfig_DELETE } from '../../utils/routeUtils.js';

export const allowedStreetsPlugin = {
    name: 'allowedStreetsPlugin',
    version: '1.0.0',
    register: async function (server, options) {
        const Ctrl = new AllowedStreetController();

        server.route([
            getGenericConfig_SEARCH(Ctrl, {
                path: '/allowed_streets',
                options: {
                    auth: {
                        strategies: ['apiKey', 'adminCookie']
                    },
                }
            }),

            getGenericConfig_GET(Ctrl, {
                path: '/allowed_street',
                options: {
                    auth: {
                        strategies: ['apiKey', 'adminCookie']
                    },
                }
            }),

            getGenericConfig_POST(Ctrl, {
                path: '/allowed_street'
            }),

            getGenericConfig_PUT(Ctrl, {
                path: '/allowed_street'
            }),

            getGenericConfig_DELETE(Ctrl, {
                path: '/allowed_street'
            })
        ]);
    }
};
