import { SignJWT } from 'jose';

// Shared by every caller that needs to sign its own Supabase-compatible Realtime token (no
// GoTrue session to source one from — see each caller's own module for why). Supabase's
// Realtime/PostgREST layer accepts a self-signed HS256 token as long as it's signed with the
// project's legacy shared JWT secret — Supabase's own documented mechanism for integrating
// non-GoTrue ("third-party") auth with RLS, kept specifically for verifying tokens even on
// projects that have otherwise migrated to asymmetric JWT Signing Keys (confirmed in this
// project's dashboard: the legacy secret still exists, with a note that it's "used to only
// verify JSON Web Tokens by Supabase products").
let _secretKey;
function getSecretKey() {
    if (!_secretKey) {
        if (!process.env.SUPABASE_JWT_SECRET) {
            throw new Error('SUPABASE_JWT_SECRET is not set');
        }
        _secretKey = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
    }
    return _secretKey;
}

/**
 * Signs a short-lived token a Supabase Realtime client presents via `realtime.setAuth(token)`.
 * `role: 'authenticated'` is the Postgres role Realtime's own connection assumes when
 * evaluating RLS for this token — not a claim this app otherwise uses. `tenant_id` is always
 * included since every RLS policy this signs for scopes on it; `claims` adds whatever else a
 * specific policy also checks (e.g. kitchen's `kitchen_role`).
 *
 * @param {{ subject: string, tenantId: string, claims?: object, ttlSeconds?: number }} args
 * @returns {Promise<string>}
 */
export async function signRealtimeToken({ subject, tenantId, claims = {}, ttlSeconds = 60 * 60 }) {
    return new SignJWT({
        role: 'authenticated',
        tenant_id: tenantId,
        ...claims
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(subject)
        .setAudience(process.env.SUPABASE_JWT_AUD || 'authenticated')
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(getSecretKey());
}
