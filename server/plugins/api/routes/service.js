import ServiceController from '../../../controllers/ServiceController.js';
import {
    getGenericConfig_SEARCH,
    getGenericConfig_GET,
    getGenericConfig_POST,
    getGenericConfig_PUT,
    getGenericConfig_DELETE } from './utils/routeUtils.js';

const Ctrl = new ServiceController();

export default (server) => {
    server.route([
        getGenericConfig_SEARCH(Ctrl, {
            path: '/services',
            options: {
                description: 'Gets a list of services',
                // auth: {
                //     strategies: ['storeauth', 'session']
                // },
            }
        }),

        getGenericConfig_GET(Ctrl, {
            path: '/service',
            options: {
                description: 'Gets a service by ID',
                // auth: {
                //     strategies: ['storeauth', 'session']
                // },
            }
        }),

        getGenericConfig_POST(Ctrl, {
            path: '/service',
            options: {
                description: 'Adds a new service',
                // auth: {
                //     strategies: ['session']
                // }
            }
        }),

        getGenericConfig_PUT(Ctrl, {
            path: '/service',
            options: {
                description: 'Updates a service',
                // auth: {
                //     strategies: ['session']
                // }
            }
        }),

        getGenericConfig_DELETE(Ctrl, {
            path: '/service',
            options: {
                description: 'Deletes a service',
                // auth: {
                //     strategies: ['session']
                // },
            }
        })
    ]);
}
