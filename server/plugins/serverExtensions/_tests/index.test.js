import { expect } from '@hapi/code';
import Lab from '@hapi/lab';
import Boom from '@hapi/boom';
import { init } from '../../../index.js';
import { createTestTenant, ownerQuery } from '../../../utils/testHelpers.js';
import db from '../../../db/knex.js';

export const lab = Lab.script();
const { describe, it, before, after } = lab;

// Direct coverage of serverExtensions/index.js's per-request transaction wrapper
// (onPreHandler/onPreResponse) itself, rather than relying on it only being exercised
// incidentally by every other plugin's own tests. The suspended-tenant check and the
// platform-staff impersonation gate (the wrapper's other two responsibilities) already have
// direct tests of their own in auth/_tests/index.test.js — this file covers the third:
// whether the transaction it opens actually commits on success and rolls back everything
// (not just the triggering error) when a handler throws. Uses throwaway routes that write
// directly against request.app.trx, the same technique auth/_tests/index.test.js's
// impersonation tests use for exercising onPreHandler's other branches.
describe('serverExtensions: per-request transaction (onPreHandler/onPreResponse)', () => {
    let server;
    let tenant;

    function adminAuth(tenantId) {
        return { strategy: 'adminBearer', credentials: { tenant_id: tenantId, role: 'owner', is_platform_staff: false } };
    }

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenant = await createTestTenant({ name: 'serverExtensions trx test tenant' });

        server.route([
            {
                method: 'POST',
                path: '/api/v1/_test-only/trx-write',
                handler: async (request, h) => {
                    await request.app.trx('email_subscribers').insert({
                        tenant_id: request.app.tenantId,
                        email: request.payload.email
                    });

                    return h.apiSuccess({ ok: true });
                }
            },
            {
                method: 'POST',
                path: '/api/v1/_test-only/trx-write-then-throw',
                handler: async (request, h) => {
                    await request.app.trx('email_subscribers').insert({
                        tenant_id: request.app.tenantId,
                        email: request.payload.email
                    });

                    throw Boom.badRequest('deliberate failure after the write');
                }
            },
            {
                method: 'GET',
                path: '/api/v1/_test-only/trx-presence',
                options: { auth: false },
                handler: (request, h) => h.apiSuccess({ hasTrx: !!request.app.trx })
            }
        ]);

        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await tenant.cleanup();
        await server.stop();
    });

    it('commits a write made inside the request transaction', { timeout: 15000 }, async () => {
        const email = `commit-${Date.now()}@example.com`;

        const res = await server.inject({
            method: 'POST',
            url: '/api/v1/_test-only/trx-write',
            auth: adminAuth(tenant.tenantId),
            payload: { email }
        });

        expect(res.statusCode).to.equal(200);

        const row = await ownerQuery('email_subscribers').where({ tenant_id: tenant.tenantId, email }).first();
        expect(row).to.exist();
    });

    it('rolls back every write from a request whose handler throws, not just the error itself', { timeout: 15000 }, async () => {
        const email = `rollback-${Date.now()}@example.com`;

        const res = await server.inject({
            method: 'POST',
            url: '/api/v1/_test-only/trx-write-then-throw',
            auth: adminAuth(tenant.tenantId),
            payload: { email }
        });

        expect(res.statusCode).to.equal(400);

        const row = await ownerQuery('email_subscribers').where({ tenant_id: tenant.tenantId, email }).first();
        expect(row).to.not.exist();
    });

    it('opens no transaction for a route with no resolved tenant_id', { timeout: 15000 }, async () => {
        const res = await server.inject({
            method: 'GET',
            url: '/api/v1/_test-only/trx-presence'
        });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.hasTrx).to.equal(false);
    });
});
