import AllowedStreetController from '../../../controllers/AllowedStreetController.js';
import {
    getGenericConfig_SEARCH,
    getGenericConfig_GET,
    getGenericConfig_POST,
    getGenericConfig_PUT,
    getGenericConfig_DELETE } from './utils/routeUtils.js';

const Ctrl = new AllowedStreetController();

export default (server) => {
    server.route([
        getGenericConfig_SEARCH(Ctrl, {
            path: '/allowed_streets',
            options: {
                // auth: {
                //     strategies: ['storeauth', 'adminCookie']
                // },
            }
        }),

        getGenericConfig_GET(Ctrl, {
            path: '/allowed_street',
            options: {
                // auth: {
                //     strategies: ['storeauth', 'adminCookie']
                // },
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
