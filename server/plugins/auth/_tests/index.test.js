import { expect } from '@hapi/code';
import Lab from '@hapi/lab';
import { init } from '../../../index.js';
import { createTestTenant, revokeApiKey, suspendTenant } from '../../../utils/testHelpers.js';
import db from '../../../db/knex.js';

export const lab = Lab.script();
const { describe, it, before, after } = lab;

// T010 (specs/004-multi-tenant-supabase/tasks.md): GET /api/v1/admin/me, and the bearer
// strategy's missing/invalid-token handling. There is no real Supabase project yet (tasks.md
// T001, pending), so a genuinely signed JWT can't be produced here — `verifyAdminToken()`
// itself (JWKS fetch + signature check) is covered once T001 lands. What IS tested here, for
// real, is everything downstream of authentication: Hapi's `server.inject({ auth })` override
// (the documented way to simulate "this request already authenticated as X" — see
// https://hapi.dev/api/#-serverinjectoptions) sets `request.auth.credentials` directly, which
// is exactly what a real, successfully-verified token would have produced, so onPreHandler's
// transaction/tenant-context wiring and meHandler's logic both run for real.
describe('GET /api/v1/admin/me', () => {
    let server;
    let tenant;

    // Each distinct connection pool's FIRST connection to DB_HOST (strawberry.local) has a
    // ~5-10s one-time delay in this environment (looks like a macOS ".local" mDNS resolution
    // quirk, unrelated to this feature's own code — confirmed by timing it directly: a second
    // query on an already-connected pool is sub-millisecond). testHelpers' owner pool and the
    // app's own `db` (appuser) pool are separate pools, so both get warmed here, in `before()`
    // (generous timeout), rather than paying for it inside a timed test body.
    before({ timeout: 20000 }, async () => {
        server = await init();
        tenant = await createTestTenant({ name: 'T010 test tenant' });
        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await tenant.cleanup();
        await server.stop();
    });

    it('returns the tenant_id/role/tenant_name/timezone from the authenticated credentials', { timeout: 15000 }, async () => {
        const res = await server.inject({
            method: 'GET',
            url: '/api/v1/admin/me',
            auth: {
                strategy: 'adminBearer',
                credentials: { tenant_id: tenant.tenantId, role: 'owner', is_platform_staff: false }
            }
        });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.tenant_id).to.equal(tenant.tenantId);
        expect(res.result.data.tenant_name).to.equal('T010 test tenant');
        expect(res.result.data.timezone).to.equal('America/Los_Angeles');
        expect(res.result.data.role).to.equal('owner');
        expect(res.result.data.is_platform_staff).to.equal(false);
    });

    it('returns 401 with no Authorization header at all', async () => {
        const res = await server.inject({
            method: 'GET',
            url: '/api/v1/admin/me'
        });

        expect(res.statusCode).to.equal(401);
    });

    it('returns 401 for a garbage bearer token', async () => {
        const res = await server.inject({
            method: 'GET',
            url: '/api/v1/admin/me',
            headers: { Authorization: 'Bearer this-is-not-a-real-jwt' }
        });

        expect(res.statusCode).to.equal(401);
    });
});


// T034 (tasks.md): platform-staff impersonation via X-Tenant-Id (contracts/tenant-resolution.md)
// only takes effect on a route that explicitly opts in (`options.app.allowPlatformStaffImpersonation`).
// AuthService.verifyAdminToken() resolves `credentials.impersonating` from the real JWT+header
// path (not exercised here, same real-JWT limitation as the describe block above), but
// onPreHandler's enforcement of the per-route opt-in is exercised for real via injected
// credentials, the same technique used throughout this file.
describe('Platform-staff cross-tenant impersonation', () => {
    let server;
    let tenant;

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenant = await createTestTenant({ name: 'T034 test tenant' });

        // No real admin route opts in yet (tasks.md T034: the mechanism exists, nothing wires
        // it on yet — no support-UI feature exists to send the header from), so a throwaway
        // route is the only way to exercise the "allowed" side of the gate.
        server.route({
            method: 'GET',
            path: '/api/v1/_test-only/impersonation-allowed',
            options: { app: { allowPlatformStaffImpersonation: true } },
            handler: (request, h) => h.apiSuccess({ tenantId: request.app.tenantId ?? null })
        });

        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await tenant.cleanup();
        await server.stop();
    });

    it('forbids impersonation on a route that has not opted in', { timeout: 15000 }, async () => {
        const res = await server.inject({
            method: 'GET',
            url: '/api/v1/admin/me',
            auth: {
                strategy: 'adminBearer',
                credentials: { tenant_id: tenant.tenantId, role: 'owner', is_platform_staff: true, impersonating: true }
            }
        });

        expect(res.statusCode).to.equal(403);
    });

    it('honors impersonation on a route that has opted in', { timeout: 15000 }, async () => {
        const res = await server.inject({
            method: 'GET',
            url: '/api/v1/_test-only/impersonation-allowed',
            auth: {
                strategy: 'adminBearer',
                credentials: { tenant_id: tenant.tenantId, role: 'owner', is_platform_staff: true, impersonating: true }
            }
        });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.tenantId).to.equal(tenant.tenantId);
    });

    it('still runs non-impersonating platform-staff requests with no tenant context', { timeout: 15000 }, async () => {
        const res = await server.inject({
            method: 'GET',
            url: '/api/v1/_test-only/impersonation-allowed',
            auth: {
                strategy: 'adminBearer',
                credentials: { tenant_id: null, role: 'owner', is_platform_staff: true, impersonating: false }
            }
        });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.tenantId).to.equal(null);
    });
});


// T035 (tasks.md): a suspended tenant is rejected immediately, before any trx/query runs, for
// both the admin and storefront paths — spec Edge Cases, "what happens when a tenant is
// deactivated or suspended".
describe('Suspended tenant handling', () => {
    let server;
    let tenant;

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenant = await createTestTenant({ name: 'T035 test tenant', product: {}, withApiKey: true });
        await suspendTenant(tenant.tenantId);
        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await tenant.cleanup();
        await server.stop();
    });

    it('rejects an admin request for a suspended tenant', { timeout: 15000 }, async () => {
        const res = await server.inject({
            method: 'GET',
            url: '/api/v1/admin/me',
            auth: {
                strategy: 'adminBearer',
                credentials: { tenant_id: tenant.tenantId, role: 'owner', is_platform_staff: false }
            }
        });

        expect(res.statusCode).to.equal(403);
    });

    it('rejects a storefront request for a suspended tenant, even with a valid API key', { timeout: 15000 }, async () => {
        const res = await server.inject({
            method: 'GET',
            url: '/api/v1/products',
            headers: { Authorization: `Basic ${Buffer.from(`store:${tenant.apiKey}`).toString('base64')}` }
        });

        expect(res.statusCode).to.equal(403);
    });
});


// T022 (tasks.md): a missing, invalid, or revoked store API key never falls through to any
// tenant's data. Uses the real Basic-auth path (AuthService.apiKeyIsValid against real
// tenant_api_keys rows), not an injected credential.
describe('Store API key rejection', () => {
    let server;
    let tenant;

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenant = await createTestTenant({ name: 'T022 test tenant', product: {}, withApiKey: true });
        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await tenant.cleanup();
        await server.stop();
    });

    it('rejects a request with no Authorization header at all', async () => {
        const res = await server.inject({ method: 'GET', url: '/api/v1/products' });
        expect(res.statusCode).to.equal(401);
    });

    it('rejects a well-formed but wrong API key', async () => {
        const res = await server.inject({
            method: 'GET',
            url: '/api/v1/products',
            headers: { Authorization: `Basic ${Buffer.from('store:not-the-right-key').toString('base64')}` }
        });

        expect(res.statusCode).to.equal(401);
    });

    it('rejects a key after it has been revoked', async () => {
        const auth = { Authorization: `Basic ${Buffer.from(`store:${tenant.apiKey}`).toString('base64')}` };

        const before = await server.inject({ method: 'GET', url: '/api/v1/products', headers: auth });
        expect(before.statusCode).to.equal(200);

        await revokeApiKey(tenant.tenantId);

        const after = await server.inject({ method: 'GET', url: '/api/v1/products', headers: auth });
        expect(after.statusCode).to.equal(401);
    });
});
