import Joi from 'joi';
import TenantController from './TenantController.js';

const ADDRESS_FIELD_SCHEMA = Joi.string().trim().max(255).allow('', null);

export const tenantPlugin = {
    name: 'tenantPlugin',
    version: '1.0.0',
    register: async function (server, options) {
        const Ctrl = new TenantController();

        server.route([
            {
                method: 'GET',
                path: '/tenant',
                options: {
                    description: 'Returns the caller\'s own tenant, including its physical address (owner-facing)',
                    handler: (request, h) => Ctrl.getHandler(request, h)
                }
            },

            {
                method: 'PUT',
                path: '/tenant/address',
                options: {
                    description: 'Updates the caller\'s own tenant\'s physical pickup address — read by the Kitchen Display System\'s order-ready email (owner-facing)',
                    validate: {
                        payload: Joi.object({
                            address_line1: ADDRESS_FIELD_SCHEMA,
                            address_line2: ADDRESS_FIELD_SCHEMA,
                            address_city: ADDRESS_FIELD_SCHEMA,
                            address_state: ADDRESS_FIELD_SCHEMA,
                            address_postal_code: ADDRESS_FIELD_SCHEMA,
                            address_phone: ADDRESS_FIELD_SCHEMA
                        })
                    },
                    handler: (request, h) => Ctrl.updateAddressHandler(request, h)
                }
            }
        ]);
    }
};
