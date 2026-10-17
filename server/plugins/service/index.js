import ServiceController from './ServiceController.js';
import {
    getGenericConfig_SEARCH,
    getGenericConfig_GET,
    getGenericConfig_POST,
    getGenericConfig_PUT,
    getGenericConfig_DELETE } from '../../utils/routeUtils.js';

export const servicePlugin = {
    name: 'servicePlugin',
    version: '1.0.0',
    register: async function (server, options) {
        const Ctrl = new ServiceController();

        server.route([
            {
                method: 'GET',
                path: '/services/next/stream',
                handler: (request, h) => Ctrl.streamHandler(request, h),
                options: {
                    description: 'Server-Sent Events stream of the service state',
                    auth: {
                        strategies: ['apiKey', 'adminCookie']
                    },
                    timeout: { socket: false, server: false },
                    response: { emptyStatusCode: 200 }
                }
            },

            {
                method: 'GET',
                path: '/services/next',
                handler: (request, h) => Ctrl.nextHandler(request, h),
                options: {
                    description: 'Gets the current or next service state',
                    auth: {
                        strategies: ['apiKey', 'adminCookie']
                    }
                }
            },

            getGenericConfig_SEARCH(Ctrl, {
                path: '/services',
                options: {
                    description: 'Gets a list of services',
                    auth: {
                        strategies: ['adminCookie']
                    },
                }
            }),

            getGenericConfig_GET(Ctrl, {
                path: '/service',
                options: {
                    description: 'Gets a service by ID',
                    auth: {
                        strategies: ['adminCookie']
                    },
                }
            }),

            getGenericConfig_POST(Ctrl, {
                path: '/service',
                options: {
                    description: 'Adds a new service'
                }
            }),

            getGenericConfig_PUT(Ctrl, {
                path: '/service',
                options: {
                    description: 'Updates a service'
                }
            }),

            getGenericConfig_DELETE(Ctrl, {
                path: '/service',
                options: {
                    description: 'Deletes a service'
                }
            })
        ]);
    }
};
