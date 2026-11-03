import { signRealtimeToken } from '../../utils/realtimeJwt.js';

const REALTIME_JWT_TTL_SECONDS = 60 * 60; // storefront re-fetches a fresh one periodically

/**
 * Signs a short-lived token the storefront's Supabase Realtime client presents via
 * `realtime.setAuth(token)`, scoped to read `tenant_service_activity` (the PII-free
 * refetch-signal table — see 20261103_tenant_service_activity.js) for this tenant only. No
 * extra claims beyond `tenant_id`: unlike the kitchen's `carts` policy, this table has nothing
 * sensitive in it, so there's nothing else for the RLS policy to need to check.
 *
 * @param {{ tenantId: string }} args
 * @returns {Promise<string>}
 */
export async function signStorefrontRealtimeToken({ tenantId }) {
    return signRealtimeToken({
        subject: tenantId,
        tenantId,
        ttlSeconds: REALTIME_JWT_TTL_SECONDS
    });
}
