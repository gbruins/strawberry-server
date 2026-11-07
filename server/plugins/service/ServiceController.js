import BaseController from '../base/BaseController.js';
import ServiceService from './ServiceService.js';
import { buildState } from './ServiceState.js';
import { signStorefrontRealtimeToken } from './realtimeToken.js';
import { getServiceAvailability, setServiceUnavailable } from './ServiceAvailability.js';

export default class ServiceController extends BaseController {

    constructor() {
        super(new ServiceService());
    }


    async nextHandler(request, h) {
        const state = await buildState(new Date(), request.app.trx, request.app.tenantId);
        return h.apiSuccess(state);
    }


    /**
     * POST /services/next/realtime-token — mints the short-lived Realtime JWT the storefront
     * presents via `realtime.setAuth(token)` to watch its own tenant's `tenant_service_activity`
     * row (see ServiceActivity.js). A missing/misconfigured SUPABASE_JWT_SECRET degrades to
     * `realtime_jwt: null` rather than failing the request — the client falls back to polling
     * GET /services/next, same graceful-degradation shape as the kitchen board's login.
     */
    async realtimeTokenHandler(request, h) {
        const tenantId = request.app.tenantId;

        let realtimeJwt = null;
        try {
            realtimeJwt = await signStorefrontRealtimeToken({ tenantId });
        }
        catch (err) {
            global.logger.error(err, { meta: { tenantId } });
        }

        return h.apiSuccess({ realtime_jwt: realtimeJwt, tenant_id: tenantId });
    }



    async getAvailabilityHandler(request, h) {
        const products = await getServiceAvailability(request.query.id, request.app.trx);
        return h.apiSuccess(products);
    }


    async setAvailabilityHandler(request, h) {
        const { id, unavailable_product_ids } = request.payload;
        const products = await setServiceUnavailable(id, unavailable_product_ids, request.app.trx, request.app.tenantId);
        return h.apiSuccess(products);
    }

}
