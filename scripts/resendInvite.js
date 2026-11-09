// dotenv is loaded via `--require dotenv/config` (see package.json's resend-invite script),
// not here — see scripts/makeApiKey.js's comment for why (ESM import hoisting).
import { createClient } from '@supabase/supabase-js';

// Resends a Supabase Auth invite for an email that already has a pending invite (e.g. its
// original redirectTo was rejected because the URL wasn't yet in the project's Auth > URL
// Configuration > Redirect URLs allow-list, so it silently fell back to the Site URL default).
// Does NOT touch tenants/admin_users/tenant_api_keys — onboardTenant.js already created those;
// re-running that script for an existing email would hit a duplicate-key error on admin_users
// and its rollback would delete the tenant it's trying to protect.
async function main() {
    const [, , email] = process.argv;

    if (!email) {
        console.error('Usage: npm run resend-invite -- <owner email>');
        process.exit(1);
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceRoleKey) {
        console.error('SUPABASE_SERVICE_ROLE_KEY env var is required (Project Settings → API →');
        console.error('service_role secret). Set it just for this run, e.g.:');
        console.error('  SUPABASE_SERVICE_ROLE_KEY=... npm run resend-invite -- owner@example.com');
        process.exit(1);
    }

    const supabaseAdmin = createClient(process.env.SUPABASE_URL, serviceRoleKey);
    const adminUrl = process.env.ADMIN_URL || 'http://localhost:5173';
    const redirectTo = `${adminUrl}/reset-password`;

    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo });

    if (!inviteError) {
        console.log(`Invite resent to ${email}, redirecting to ${redirectTo}`);
        return;
    }

    // The invite link's auth server leg confirms the email BEFORE redirecting, even if the
    // redirectTo itself was broken (e.g. not yet in Supabase's Redirect URLs allow-list) — so a
    // once-broken invite link can leave the user confirmed with no usable password. Supabase's
    // invite API refuses to re-invite an already-confirmed user; the self-service
    // "forgot password" mechanism (same ResetPasswordPage.vue flow) works for them instead.
    if (!inviteError.message?.includes('already been registered')) {
        console.error(`Resend failed for ${email}: ${inviteError.message}`);
        process.exit(1);
    }

    const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo });

    if (resetError) {
        console.error(`Password-reset fallback also failed for ${email}: ${resetError.message}`);
        process.exit(1);
    }

    console.log(`${email} was already confirmed (likely from a previously broken invite link) —`);
    console.log(`sent a password-reset link instead, redirecting to ${redirectTo}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
