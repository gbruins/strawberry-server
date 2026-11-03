import Joi from 'joi';
import KitchenStationController from './KitchenStationController.js';
import KitchenTicketController from './KitchenTicketController.js';

const PIN_SCHEMA = Joi.string().trim().pattern(/^[0-9]{4,6}$/).required();
const STATION_CODE_SCHEMA = Joi.string().trim().uppercase().max(12).required();
const ID_SCHEMA = Joi.string().uuid().required();

export const kitchenPlugin = {
    name: 'kitchenPlugin',
    version: '1.0.0',
    register: async function (server, options) {
        const StationCtrl = new KitchenStationController();
        const TicketCtrl = new KitchenTicketController();

        server.route([
            {
                method: 'POST',
                path: '/kitchen/session',
                options: {
                    description: 'Logs a kitchen station in by station_code + PIN, returns a shift-length session token',
                    auth: false,
                    plugins: {
                        // PINs are low-entropy by design (shared-station UX) — this is the
                        // brute-force backstop, same shape as /cart/checkout's own limit.
                        'hapi-rate-limit': { pathLimit: false, userPathLimit: 10 }
                    },
                    validate: {
                        payload: Joi.object({
                            station_code: STATION_CODE_SCHEMA,
                            pin: PIN_SCHEMA
                        })
                    },
                    handler: (request, h) => StationCtrl.sessionHandler(request, h)
                }
            },

            {
                method: 'POST',
                path: '/kitchen/session/verify-pin',
                options: {
                    description: 'Re-checks a station\'s PIN to unlock the board\'s idle-lock overlay',
                    auth: { strategies: ['stationBearer'] },
                    plugins: {
                        'hapi-rate-limit': { pathLimit: false, userPathLimit: 10 }
                    },
                    validate: {
                        payload: Joi.object({ pin: PIN_SCHEMA })
                    },
                    handler: (request, h) => StationCtrl.verifyPinHandler(request, h)
                }
            },

            {
                method: 'POST',
                path: '/kitchen/session/refresh',
                options: {
                    description: 'Reissues a station\'s short-lived Supabase Realtime token',
                    auth: { strategies: ['stationBearer'] },
                    handler: (request, h) => StationCtrl.refreshHandler(request, h)
                }
            },

            {
                method: 'GET',
                path: '/kitchen/tickets',
                options: {
                    description: 'Lists the current kitchen tickets (paid carts with a kitchen_status) for the caller\'s tenant',
                    auth: { strategies: ['adminOrKitchenBearer'] },
                    handler: (request, h) => TicketCtrl.listHandler(request, h)
                }
            },

            {
                method: 'GET',
                path: '/kitchen/stations',
                options: {
                    description: 'Lists the kitchen stations for the caller\'s tenant (owner-facing)',
                    auth: { strategies: ['adminBearer'] },
                    handler: (request, h) => StationCtrl.searchHandler(request, h)
                }
            },

            {
                method: 'POST',
                path: '/kitchen/stations',
                options: {
                    description: 'Creates a kitchen station with an owner-chosen PIN (owner-facing)',
                    auth: { strategies: ['adminBearer'] },
                    validate: {
                        payload: Joi.object({
                            name: Joi.string().trim().max(100).required(),
                            pin: PIN_SCHEMA
                        })
                    },
                    handler: (request, h) => StationCtrl.createStationHandler(request, h)
                }
            },

            {
                method: 'PUT',
                path: '/kitchen/stations/rotate-pin',
                options: {
                    description: 'Rotates a kitchen station\'s PIN and invalidates its current session (owner-facing)',
                    auth: { strategies: ['adminBearer'] },
                    validate: {
                        payload: Joi.object({
                            id: ID_SCHEMA,
                            pin: PIN_SCHEMA
                        })
                    },
                    handler: (request, h) => StationCtrl.rotatePinHandler(request, h)
                }
            },

            {
                method: 'DELETE',
                path: '/kitchen/stations',
                options: {
                    description: 'Revokes a kitchen station, invalidating any live session (owner-facing)',
                    auth: { strategies: ['adminBearer'] },
                    validate: {
                        query: Joi.object({ id: ID_SCHEMA })
                    },
                    handler: (request, h) => StationCtrl.revokeHandler(request, h)
                }
            }
        ]);
    }
};
