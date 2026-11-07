import Boom from '@hapi/boom';

const ADDRESS_FIELDS = ['address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code', 'address_phone'];

export default class TenantController {

    /**
     * GET /tenant — the caller's own tenant, including the physical address fields the
     * Kitchen Display System's order-ready email reads (NotificationService.sendOrderReadyEmail).
     * No `id` param: there's exactly one tenant a given admin request can ever resolve to
     * (request.app.tenantId, set by onPreHandler) — never client-suppliable.
     */
    async getHandler(request, h) {
        try {
            const tenant = await request.app.trx('tenants')
                .where({ id: request.app.tenantId })
                .first('id', 'name', 'timezone', 'status', ...ADDRESS_FIELDS);

            return h.apiSuccess(tenant);
        }
        catch (err) {
            global.logger.error(err);
            throw Boom.badRequest(err.message);
        }
    }


    /**
     * PUT /tenant/address — updates only the address fields on the caller's own tenant.
     * tenants' column-level GRANT (20261102120400_tenant_address_write.js) is the real backstop
     * here — name/timezone/status are not grantable through this write path even if this
     * handler's field whitelist were ever bypassed.
     */
    async updateAddressHandler(request, h) {
        try {
            const payload = {};

            ADDRESS_FIELDS.forEach((field) => {
                payload[field] = request.payload[field] || null;
            });

            const [updated] = await request.app.trx('tenants')
                .where({ id: request.app.tenantId })
                .update(payload)
                .returning(['id', ...ADDRESS_FIELDS]);

            return h.apiSuccess(updated);
        }
        catch (err) {
            global.logger.error(err);
            throw Boom.badRequest(err.message);
        }
    }

}
