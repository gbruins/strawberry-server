import Boom from '@hapi/boom';
import isObject from 'lodash.isobject';
import AuthService, { AdminUserNotFoundError } from '../auth/AuthService.js';
import db from '../../db/knex.js';

export const serverExtensionsPlugin = {
    name: 'serverExtensionsPlugin',
    version: '1.0.0',
    register: async function (server, options) {

        const isProd = process.env.NODE_ENV === 'production';
        const AuthSvc = new AuthService();

        // Basic auth for store API usage — the key alone resolves which tenant a storefront
        // request belongs to (contracts/tenant-resolution.md), attached to credentials here
        // so onPreHandler below can open that tenant's transaction.
        server.auth.strategy('apiKey', 'basic', {
            validate: async (request, userId, api_key) => {
                const { isValid, tenantId } = await AuthSvc.apiKeyIsValid(userId, api_key);

                return {
                    isValid,
                    credentials: isValid ? { userId, tenant_id: tenantId } : {}
                };
            }
        });


        // --- Admin auth: Supabase Auth JWT, verified server-side (contracts/admin-auth.md) ---
        // Replaces the old cookie-session strategy. Hand-rolled scheme (not a package) since
        // verification is just "check the Authorization header, call AuthService" — matches
        // this codebase's existing style of hand-rolling apiKeyIsValid() above rather than
        // pulling in a dependency for something this small.
        server.auth.scheme('bearer-jwt', (server, options) => ({
            authenticate: async (request, h) => {
                const header = request.headers.authorization;

                if (!header || !header.startsWith('Bearer ')) {
                    throw Boom.unauthorized(null, 'Bearer');
                }

                try {
                    const credentials = await options.validate(header.slice(7), request);
                    return h.authenticated({ credentials });
                }
                catch (err) {
                    global.logger.error(err);

                    // contracts/admin-auth.md distinguishes these: a valid, successfully
                    // verified token with no admin_users row is 403 (who you are is fine, you
                    // just have no authorization here), not 401 (invalid/expired token) —
                    // found and fixed after independent QA review flagged both were
                    // collapsing into the same 401.
                    if (err instanceof AdminUserNotFoundError) {
                        throw Boom.forbidden('No admin account for this user');
                    }

                    throw Boom.unauthorized('Invalid token', 'Bearer');
                }
            }
        }));

        server.auth.strategy('adminBearer', 'bearer-jwt', {
            validate: (token, request) => AuthSvc.verifyAdminToken(token, request.headers['x-tenant-id'])
        });


        // https://hapi.dev/tutorials/auth/?lang=en_US#default
        // Deny by default: routes are admin-only unless they declare their own auth.
        // `/auth/login` and `/auth/logout` declare `auth: false` themselves (server/plugins/auth/index.js)
        // and are unaffected by this default either way.
        server.auth.default('adminBearer');

        server.decorate('toolkit', 'apiSuccess', function (responseData) {
            const response = {};
            response.data = isObject(responseData) && responseData.hasOwnProperty('data')
                ? responseData.data
                : responseData;

            if(isObject(responseData) && responseData.hasOwnProperty('pagination')) {
                response.pagination = responseData.pagination;
            }

            return this.response(response);
        });


        // Updates the response output with a 'data' property if a data
        // property also exists in the Boom error
        server.ext('onPreResponse', (request, h) => {
            const response = request.response;

            if (!response.isBoom || !response.hasOwnProperty('output')) {
                return h.continue;
            }

            const is4xx = response.output.statusCode >= 400 && response.output.statusCode < 500;

            if (is4xx && response.data) {
                response.output.payload.data = response.data;
            }

            return h.continue;
        });


        // --- Multi-tenant Row-Level Security context (specs/004-multi-tenant-supabase) ---
        //
        // Postgres RLS policies on tenant-scoped tables read `current_setting('app.current_tenant_id', true)`.
        // That setting only exists for the lifetime of a transaction set via `SET LOCAL`, so every
        // request that touches tenant-scoped data must run its queries inside one transaction that
        // we open here and commit/rollback in onPreResponse below. BaseService/BaseController thread
        // this transaction through as `config.trx` / `request.app.trx` rather than relying on
        // AsyncLocalStorage, because Hapi's extension points don't give middleware a `next()` it
        // calls itself — onPreHandler returning `h.continue` hands control back to Hapi's own
        // lifecycle loop, so a later route handler is not a nested continuation of this callback and
        // would not see ALS context set here.
        //
        // Routes with no resolved tenant_id (no auth, or platform-staff with no X-Tenant-Id) simply
        // run without a trx; BaseService falls back to the bare `db` singleton in that case.
        server.ext('onPreHandler', async (request, h) => {
            const credentials = request.auth?.credentials;
            const tenantId = credentials?.tenant_id;

            // contracts/tenant-resolution.md: a route must explicitly opt in
            // (`options.app.allowPlatformStaffImpersonation = true`) before an X-Tenant-Id
            // impersonation resolved by AuthService.verifyAdminToken is honored at all — no
            // route opts in yet (no support-UI feature exists to send the header from), so
            // today this only matters once one does.
            if (credentials?.impersonating && !request.route.settings.app?.allowPlatformStaffImpersonation) {
                throw Boom.forbidden('This route does not allow platform-staff cross-tenant access');
            }

            if (!tenantId) {
                return h.continue;
            }

            // Suspended tenants are rejected before a transaction is even opened, for both the
            // admin and storefront paths alike (spec Edge Cases: "what happens when a tenant is
            // deactivated or suspended") — this is the one place both resolution paths converge
            // on a single tenantId, so the check lives here rather than duplicated in both
            // AuthService.verifyAdminToken and AuthService.apiKeyIsValid.
            const tenantRow = await db('tenants').where({ id: tenantId }).first('status');

            if (tenantRow?.status === 'suspended') {
                throw Boom.forbidden('This tenant has been suspended');
            }

            const trx = await db.transaction();

            try {
                // Postgres's SET command does not accept protocol-level bind parameters at all
                // (confirmed by hitting "syntax error at or near $1" using SET LOCAL ... = ?).
                // set_config() is a regular function call, so it takes a real bind parameter;
                // its third argument (true) scopes the setting to the current transaction, the
                // same as SET LOCAL.
                await trx.raw('SELECT set_config(?, ?, true)', ['app.current_tenant_id', tenantId]);
            }
            catch (err) {
                await trx.rollback();
                global.logger.error(err);
                throw Boom.badImplementation();
            }

            request.app.trx = trx;
            request.app.tenantId = tenantId;

            return h.continue;
        });

        server.ext('onPreResponse', async (request, h) => {
            const trx = request.app.trx;

            if (!trx) {
                return h.continue;
            }

            if (request.response.isBoom) {
                try {
                    await trx.rollback();
                }
                catch (err) {
                    global.logger.error(err);
                }

                return h.continue;
            }

            try {
                await trx.commit();
                return h.continue;
            }
            catch (err) {
                // A failed commit must not let the already-computed success response through —
                // the client would be told the write succeeded when it didn't. Best-effort
                // rollback for cleanliness (commit failing can itself leave the transaction
                // already aborted, so this may be a no-op); either way, report the failure.
                global.logger.error(err);

                try {
                    await trx.rollback();
                }
                catch (rollbackErr) {
                    global.logger.error(rollbackErr);
                }

                return Boom.badImplementation();
            }
        });
    }
};
