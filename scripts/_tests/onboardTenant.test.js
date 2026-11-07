import { expect } from '@hapi/code';
import Lab from '@hapi/lab';
import knexLib from 'knex';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { onboardTenant } from '../onboardTenant.js';
import knexConfig from '../../server/knexfile.js';

export const lab = Lab.script();
const { describe, it, after } = lab;

// T030 (specs/004-multi-tenant-supabase/tasks.md): runs the real onboarding logic (real DB
// writes against whatever database knexfile.js points at) twice with different inputs and
// confirms the two tenants share nothing. `supabaseAdmin` is stubbed rather than real — the
// script itself (scripts/onboardTenant.js, run directly) needs a real SUPABASE_SERVICE_ROLE_KEY
// and sends a real invite email; this test shouldn't require either just to verify the DB side
// of the logic is correct. Run explicitly with `npm run test:onboarding` (not part of the main
// `npm test`, which only scans server/ and shouldn't need Supabase Admin API access to pass).
describe('onboardTenant', () => {
    const db = knexLib(knexConfig);
    const createdTenantIds = [];

    function fakeSupabaseAdmin() {
        return {
            auth: {
                admin: {
                    inviteUserByEmail: async () => ({ data: { user: { id: uuidv4() } }, error: null })
                }
            }
        };
    }

    after({ timeout: 10000 }, async () => {
        for (const tenantId of createdTenantIds) {
            await db('tenant_api_keys').where({ tenant_id: tenantId }).del();
            await db('admin_users').where({ tenant_id: tenantId }).del();
            await db('product_types').where({ tenant_id: tenantId }).del();
            await db('tenants').where({ id: tenantId }).del();
        }
        await db.destroy();
    });

    it('produces two tenants with no shared data', { timeout: 15000 }, async () => {
        const resultA = await onboardTenant({
            name: `T030 Tenant A ${Date.now()}`,
            timezone: 'America/Los_Angeles',
            email: `t030-a-${Date.now()}@example.com`,
            supabaseAdmin: fakeSupabaseAdmin(),
            adminUrl: 'http://localhost:5173'
        });
        createdTenantIds.push(resultA.tenantId);

        const resultB = await onboardTenant({
            name: `T030 Tenant B ${Date.now()}`,
            timezone: 'America/New_York',
            email: `t030-b-${Date.now()}@example.com`,
            supabaseAdmin: fakeSupabaseAdmin(),
            adminUrl: 'http://localhost:5173'
        });
        createdTenantIds.push(resultB.tenantId);

        // Distinct tenants, distinct Auth users, distinct API keys.
        expect(resultA.tenantId).to.not.equal(resultB.tenantId);
        expect(resultA.authUserId).to.not.equal(resultB.authUserId);
        expect(resultA.apiKeyToken).to.not.equal(resultB.apiKeyToken);

        const adminUserA = await db('admin_users').where({ id: resultA.authUserId }).first();
        const adminUserB = await db('admin_users').where({ id: resultB.authUserId }).first();

        expect(adminUserA.tenant_id).to.equal(resultA.tenantId);
        expect(adminUserB.tenant_id).to.equal(resultB.tenantId);
        expect(adminUserA.tenant_id).to.not.equal(adminUserB.tenant_id);

        const apiKeyRowA = await db('tenant_api_keys').where({ tenant_id: resultA.tenantId }).first();
        const apiKeyRowB = await db('tenant_api_keys').where({ tenant_id: resultB.tenantId }).first();

        // Each tenant's key only validates against its own tenant's stored hash.
        expect(bcrypt.compareSync(resultA.apiKeyToken, apiKeyRowA.key_hash)).to.be.true();
        expect(bcrypt.compareSync(resultA.apiKeyToken, apiKeyRowB.key_hash)).to.be.false();
        expect(bcrypt.compareSync(resultB.apiKeyToken, apiKeyRowB.key_hash)).to.be.true();
        expect(bcrypt.compareSync(resultB.apiKeyToken, apiKeyRowA.key_hash)).to.be.false();

        // Each tenant gets its own built-in Pizza product type
        for (const { tenantId } of [resultA, resultB]) {
            const types = await db('product_types').where({ tenant_id: tenantId }).select('slug');
            expect(types.map((t) => t.slug)).to.equal(['pizza']);
        }
    });

    it('rolls back the tenant row if the Supabase invite fails', { timeout: 15000 }, async () => {
        const failingSupabaseAdmin = {
            auth: {
                admin: {
                    inviteUserByEmail: async () => ({ data: null, error: { message: 'simulated failure' } })
                }
            }
        };

        const nameBefore = `T030 Should Not Persist ${Date.now()}`;

        await expect(onboardTenant({
            name: nameBefore,
            timezone: 'America/Los_Angeles',
            email: 'should-not-be-created@example.com',
            supabaseAdmin: failingSupabaseAdmin,
            adminUrl: 'http://localhost:5173'
        })).to.reject();

        const orphanedTenant = await db('tenants').where({ name: nameBefore }).first();
        expect(orphanedTenant).to.not.exist();
    });

    it('rolls back the tenant row if admin_users insert fails after a successful invite', { timeout: 15000 }, async () => {
        // Found by QA review: Supabase's real inviteUserByEmail returns the SAME auth user id
        // when re-invited while a prior invite is still pending, so a second onboarding run for
        // an email already mid-invite hits a duplicate-key error on admin_users, not on the
        // invite call itself. Modeled here with a stub that always returns one fixed user id,
        // confirming the second run's tenant row doesn't survive that later failure either.
        const fixedAuthUserId = uuidv4();
        const sameUserStub = {
            auth: { admin: { inviteUserByEmail: async () => ({ data: { user: { id: fixedAuthUserId } }, error: null }) } }
        };

        const firstResult = await onboardTenant({
            name: `T030 Dup First ${Date.now()}`,
            timezone: 'America/Los_Angeles',
            email: 'dup@example.com',
            supabaseAdmin: sameUserStub,
            adminUrl: 'http://localhost:5173'
        });
        createdTenantIds.push(firstResult.tenantId);

        const secondName = `T030 Dup Second ${Date.now()}`;

        await expect(onboardTenant({
            name: secondName,
            timezone: 'America/Los_Angeles',
            email: 'dup@example.com',
            supabaseAdmin: sameUserStub,
            adminUrl: 'http://localhost:5173'
        })).to.reject();

        const orphanedTenant = await db('tenants').where({ name: secondName }).first();
        expect(orphanedTenant).to.not.exist();
    });
});
