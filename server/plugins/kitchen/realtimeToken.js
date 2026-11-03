import { SignJWT } from 'jose';

// Separate from AuthService's SUPABASE_URL-derived JWKS verification (that verifies Supabase's
// own GoTrue-issued tokens for owners) — this SIGNS our own token for a station, which has no
// GoTrue session to source one from. Supabase's Realtime/PostgREST layer accepts a
// self-signed HS256 token as long as it's signed with the project's legacy shared JWT secret —
// Supabase's own documented mechanism for integrating non-GoTrue ("third-party") auth with
// RLS, kept specifically for verifying tokens even on projects that have otherwise migrated to
// asymmetric JWT Signing Keys (confirmed in this project's dashboard: the legacy secret still
// exists, with a note that it's "used to only verify JSON Web Tokens by Supabase products").
const REALTIME_JWT_TTL_SECONDS = 60 * 60; // re-signed on /kitchen/session/refresh well before expiry

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
 * Signs a short-lived token a kitchen station's Supabase Realtime client presents via
 * `realtime.setAuth(token)`, carrying exactly the two custom claims the additive RLS policy
 * on `carts` (20261102120300_kitchen_realtime_rls.js) checks: `tenant_id` and `kitchen_role`.
 * `role: 'authenticated'` is the Postgres role Realtime's own connection assumes when
 * evaluating RLS for this token — not a claim this app otherwise uses.
 *
 * @param {{ stationId: string, tenantId: string }} args
 * @returns {Promise<string>}
 */
export async function signKitchenRealtimeToken({ stationId, tenantId }) {
    return new SignJWT({
        role: 'authenticated',
        tenant_id: tenantId,
        kitchen_role: 'kitchen'
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(stationId)
        .setAudience(process.env.SUPABASE_JWT_AUD || 'authenticated')
        .setIssuedAt()
        .setExpirationTime(`${REALTIME_JWT_TTL_SECONDS}s`)
        .sign(getSecretKey());
}
