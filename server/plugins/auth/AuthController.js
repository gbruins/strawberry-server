import Boom from '@hapi/boom';
import BaseController from '../base/BaseController.js';
import AuthService from './AuthService.js';

export default class AuthController extends BaseController {

    constructor() {
        super(new AuthService());
    }

    /**
     * GET /admin/me (contracts/admin-auth.md) — tells strawberry-admin which tenant/role the
     * caller's bearer token resolved to. Login/logout themselves are no longer server routes:
     * strawberry-admin calls Supabase Auth directly for those (research.md #2).
     */
    async meHandler(request, h) {
        try {
            const tenant = await this.service.getTenant(request.auth.credentials.tenant_id);

            return h.apiSuccess({
                tenant_id: request.auth.credentials.tenant_id,
                tenant_name: tenant?.name ?? null,
                timezone: tenant?.timezone ?? null,
                role: request.auth.credentials.role,
                is_platform_staff: request.auth.credentials.is_platform_staff
            });
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }

}
