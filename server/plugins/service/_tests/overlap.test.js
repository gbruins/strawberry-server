import { expect } from '@hapi/code';
import Lab from '@hapi/lab';
import { init } from '../../../index.js';
import { createTestTenant, ownerQuery } from '../../../utils/testHelpers.js';

export const lab = Lab.script();
const { describe, it, before, after } = lab;

// A service's [start_at, end_at] window must not overlap any other service for the same
// tenant (ServiceService.assertNoOverlap) — otherwise staff could double-book the same dough
// allocation across two concurrent windows.
describe('Service window overlap validation', () => {
    let server;
    let tenant;

    function adminAuth(tenantId) {
        return { strategy: 'adminBearer', credentials: { tenant_id: tenantId, role: 'owner', is_platform_staff: false } };
    }

    function createService(tenantId, start_at, end_at) {
        return server.inject({
            method: 'POST',
            url: '/api/v1/service',
            auth: adminAuth(tenantId),
            payload: { start_at, end_at }
        });
    }

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenant = await createTestTenant({ name: 'Service overlap test tenant' });
    });

    after({ timeout: 10000 }, async () => {
        await ownerQuery('service').where({ tenant_id: tenant.tenantId }).del();
        await tenant.cleanup();
        await server.stop();
    });

    it('creates a service with no conflicting window', { timeout: 15000 }, async () => {
        const res = await createService(tenant.tenantId, '2026-06-01T17:00:00.000Z', '2026-06-01T20:00:00.000Z');

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.id).to.exist();
    });

    it('rejects a create whose window overlaps an existing service', { timeout: 15000 }, async () => {
        const res = await createService(tenant.tenantId, '2026-06-01T18:00:00.000Z', '2026-06-01T21:00:00.000Z');

        expect(res.statusCode).to.equal(400);
        expect(res.result.message).to.include('overlaps');
    });

    it('allows a service that starts exactly when another ends (touching, not overlapping)', { timeout: 15000 }, async () => {
        const res = await createService(tenant.tenantId, '2026-06-01T20:00:00.000Z', '2026-06-01T22:00:00.000Z');

        expect(res.statusCode).to.equal(200);
    });

    it('rejects an update that would move a service onto an existing one', { timeout: 15000 }, async () => {
        const createRes = await createService(tenant.tenantId, '2026-07-01T17:00:00.000Z', '2026-07-01T20:00:00.000Z');
        const movable = createRes.result.data;

        const res = await server.inject({
            method: 'PUT',
            url: '/api/v1/service',
            auth: adminAuth(tenant.tenantId),
            payload: { id: movable.id, start_at: '2026-06-01T18:30:00.000Z', end_at: '2026-06-01T19:30:00.000Z' }
        });

        expect(res.statusCode).to.equal(400);
        expect(res.result.message).to.include('overlaps');
    });

    it('allows updating a service within a window that only overlaps its own previous window', { timeout: 15000 }, async () => {
        const createRes = await createService(tenant.tenantId, '2026-08-01T17:00:00.000Z', '2026-08-01T20:00:00.000Z');
        const service = createRes.result.data;

        // Shifted by 30 minutes — still overlaps this same service's OWN prior window, which
        // must not self-conflict since the update excludes its own id from the comparison.
        const res = await server.inject({
            method: 'PUT',
            url: '/api/v1/service',
            auth: adminAuth(tenant.tenantId),
            payload: { id: service.id, start_at: '2026-08-01T17:30:00.000Z', end_at: '2026-08-01T20:30:00.000Z' }
        });

        expect(res.statusCode).to.equal(200);
    });

    it('does not check overlap when start_at/end_at are left null', { timeout: 15000 }, async () => {
        const res = await createService(tenant.tenantId, null, null);

        expect(res.statusCode).to.equal(200);
    });
});
