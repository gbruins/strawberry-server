// dotenv is loaded via `--require dotenv/config` (see package.json's onboard-tenant script),
// not here — see scripts/makeApiKey.js's comment for why (ESM import hoisting).
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import { createClient } from '@supabase/supabase-js';
import knexConfig from '../server/knexfile.js';
import { sha256Hex } from '../server/utils/utils.js';
import { ensureBuiltInProductTypes } from '../server/plugins/productTypes/builtInProductTypes.js';

// Runs as the owner/superuser (knexfile.js's connection) — same as migrations/makeApiKey.js —
// since admin_users/tenant_api_keys only grant the restricted app role SELECT, not INSERT.
const db = knexLib(knexConfig);

/**
 * Onboards one new tenant: creates its `tenants` row, invites its owner via Supabase Auth,
 * creates the matching `admin_users` row, seeds the built-in product types, and issues one
 * storefront API key.
 *
 * `supabaseAdmin` is injected (rather than constructed in here) so tests can pass a stub that
 * doesn't need a real SUPABASE_SERVICE_ROLE_KEY or send a real email.
 */
export async function onboardTenant({ name, timezone, email, supabaseAdmin, adminUrl }) {
    const [tenant] = await db('tenants').insert({ name, timezone }).returning('*');

    try {
        // Pizza is required for the per-order cap and inventory to apply to anything
        await ensureBuiltInProductTypes(db, tenant.id);

        // The route's vue-router *name* is 'reset_password' (underscore); its actual URL path
        // is '/reset-password' (hyphen, strawberry-admin/src/router/index.ts) — found by QA
        // review confirming every real invite link would otherwise 404 with no fallback route.
        const { data: invite, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
            email,
            { redirectTo: `${adminUrl}/reset-password` }
        );

        if (inviteError) {
            throw new Error(`Supabase invite failed for ${email}: ${inviteError.message}`);
        }

        const authUserId = invite.user.id;

        await db('admin_users').insert({
            id: authUserId,
            tenant_id: tenant.id,
            role: 'owner',
            is_platform_staff: false
        });

        const apiKeyToken = uuidv4().replace(/-/g, '');
        await db('tenant_api_keys').insert({
            tenant_id: tenant.id,
            key_hash: bcrypt.hashSync(apiKeyToken, bcrypt.genSaltSync(10)),
            lookup_hash: sha256Hex(apiKeyToken)
        });

        return { tenantId: tenant.id, authUserId, apiKeyToken };
    }
    catch (err) {
        // Roll back everything this run managed to create (found by QA review: re-running for
        // an email with a still-pending invite returns the SAME Supabase Auth user id, so the
        // second run's admin_users insert hits a duplicate-key error here — without this catch,
        // that left an orphaned tenants row with no admin_users/tenant_api_keys behind it, with
        // no error pointing at the orphan for staff to find).
        await db('tenant_api_keys').where({ tenant_id: tenant.id }).del();
        await db('admin_users').where({ tenant_id: tenant.id }).del();
        await db('product_types').where({ tenant_id: tenant.id }).del();
        await db('tenants').where({ id: tenant.id }).del();
        throw err;
    }
}

async function runFromCli() {
    const [, , name, timezone, email] = process.argv;

    if (!name || !timezone || !email) {
        console.error('Usage: npm run onboard-tenant -- "<tenant name>" "<IANA timezone>" "<owner email>"');
        console.error('Example: npm run onboard-tenant -- "Tony\'s Pizza" "America/New_York" owner@example.com');
        process.exit(1);
    }

    // The service_role key bypasses RLS and every Auth check — deliberately not read from
    // .env (unlike every other credential here), so it only exists in this one process's env
    // for the duration of a single onboarding run, not sitting in a file on disk.
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceRoleKey) {
        console.error('SUPABASE_SERVICE_ROLE_KEY env var is required (Project Settings → API →');
        console.error('service_role secret). Set it just for this run, e.g.:');
        console.error('  SUPABASE_SERVICE_ROLE_KEY=... npm run onboard-tenant -- "..." "..." "..."');
        process.exit(1);
    }

    const supabaseAdmin = createClient(process.env.SUPABASE_URL, serviceRoleKey);
    // Where the invite email's link lands to let the new owner set their own password — reuses
    // the same page/flow as the "forgot password" case (strawberry-admin's ResetPasswordPage.vue).
    const adminUrl = process.env.ADMIN_URL || 'http://localhost:5173';

    try {
        const result = await onboardTenant({ name, timezone, email, supabaseAdmin, adminUrl });

        console.log('\nOnboarding complete.');
        console.log(`  Tenant ID: ${result.tenantId}`);
        console.log(`  ${email} will receive an invite email to set their admin password and sign in.`);
        console.log(`  Storefront API key (hand to this tenant's own developer for their separate`);
        console.log(`  storefront deployment's VITE_API_KEY — shown once, not recoverable):`);
        console.log(`  ${result.apiKeyToken}`);
    }
    finally {
        await db.destroy();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runFromCli().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
