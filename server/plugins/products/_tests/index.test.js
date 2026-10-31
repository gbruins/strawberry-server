import { expect } from '@hapi/code';
import Lab from '@hapi/lab';
import { init } from '../../../index.js';
import { createTestTenant } from '../../../utils/testHelpers.js';
import db from '../../../db/knex.js';

export const lab = Lab.script();
const { describe, it, before, after } = lab;

// T011 (specs/004-multi-tenant-supabase/tasks.md): a bearer token for Tenant A cannot read a
// Tenant B product via any admin route. Uses `server.inject({ auth })` to simulate an
// already-authenticated admin for Tenant A (see the comment in ../../auth/_tests/index.test.js
// for why — no real Supabase project yet to sign a real JWT against). This test exercises the
// REAL RLS policy and the REAL onPreHandler transaction wiring end to end; only the JWT
// signature-verification step itself is bypassed.
describe('Cross-tenant product isolation', () => {
    let server;
    let tenantA;
    let tenantB;

    // See the comment in ../../auth/_tests/index.test.js's before() — same one-time
    // per-pool connection-warmup cost, paid here instead of inside a timed test body.
    before({ timeout: 20000 }, async () => {
        server = await init();
        tenantA = await createTestTenant({ name: 'T011 Tenant A', product: { title: 'Tenant A Pizza' } });
        tenantB = await createTestTenant({ name: 'T011 Tenant B', product: { title: 'Tenant B Pizza' } });
        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await tenantA.cleanup();
        await tenantB.cleanup();
        await server.stop();
    });

    function asTenant(tenantId) {
        return { strategy: 'adminBearer', credentials: { tenant_id: tenantId, role: 'owner', is_platform_staff: false } };
    }

    it("Tenant A's admin CAN read Tenant A's own product", async () => {
        const res = await server.inject({
            method: 'GET',
            url: `/api/v1/product?id=${tenantA.product.id}`,
            auth: asTenant(tenantA.tenantId)
        });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.id).to.equal(tenantA.product.id);
        expect(res.result.data.title).to.equal('Tenant A Pizza');
    });

    it("Tenant A's admin CANNOT read Tenant B's product by id", async () => {
        const res = await server.inject({
            method: 'GET',
            url: `/api/v1/product?id=${tenantB.product.id}`,
            auth: asTenant(tenantA.tenantId)
        });

        // GET /product's existing (pre-existing-to-this-feature) convention returns 200 with
        // an empty body for "not found" rather than 404 — confirmed by direct inspection, not
        // assumed. What actually matters here: the body must not contain Tenant B's data.
        expect(res.statusCode).to.equal(200);
        expect(res.result.data).to.not.exist();
    });

    it("Tenant A's admin search results never include Tenant B's product", async () => {
        const res = await server.inject({
            method: 'GET',
            url: '/api/v1/products',
            auth: asTenant(tenantA.tenantId)
        });

        expect(res.statusCode).to.equal(200);
        const ids = res.result.data.map((p) => p.id);
        expect(ids).to.include(tenantA.product.id);
        expect(ids).to.not.include(tenantB.product.id);
    });
});


// T021 (tasks.md): same isolation guarantee, but via the REAL storefront path — real Basic
// auth against real bcrypt-hashed tenant_api_keys rows (AuthService.apiKeyIsValid), not an
// injected admin credential. This is the one place in this suite that exercises that function
// for real, end to end.
describe('Cross-tenant storefront isolation via real API keys', () => {
    let server;
    let tenantA;
    let tenantB;

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenantA = await createTestTenant({ name: 'T021 Tenant A', product: { title: 'Tenant A Pizza' }, withApiKey: true });
        tenantB = await createTestTenant({ name: 'T021 Tenant B', product: { title: 'Tenant B Pizza' }, withApiKey: true });
        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await tenantA.cleanup();
        await tenantB.cleanup();
        await server.stop();
    });

    function authHeader(apiKey) {
        return { Authorization: `Basic ${Buffer.from(`store:${apiKey}`).toString('base64')}` };
    }

    it("Tenant A's own API key only ever returns Tenant A's products", async () => {
        const res = await server.inject({
            method: 'GET',
            url: '/api/v1/products',
            headers: authHeader(tenantA.apiKey)
        });

        expect(res.statusCode).to.equal(200);
        const ids = res.result.data.map((p) => p.id);
        expect(ids).to.include(tenantA.product.id);
        expect(ids).to.not.include(tenantB.product.id);
    });

    it("Tenant B's own API key only ever returns Tenant B's products", async () => {
        const res = await server.inject({
            method: 'GET',
            url: '/api/v1/products',
            headers: authHeader(tenantB.apiKey)
        });

        expect(res.statusCode).to.equal(200);
        const ids = res.result.data.map((p) => p.id);
        expect(ids).to.include(tenantB.product.id);
        expect(ids).to.not.include(tenantA.product.id);
    });
});
