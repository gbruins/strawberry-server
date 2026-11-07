import { signRealtimeToken } from '../../utils/realtimeJwt.js';

const REALTIME_JWT_TTL_SECONDS = 60 * 60; // re-signed on /kitchen/session/refresh well before expiry

/**
 * Signs a short-lived token a kitchen station's Supabase Realtime client presents via
 * `realtime.setAuth(token)`, carrying the custom claim the additive RLS policy on `carts`
 * (20261102120300_kitchen_realtime_rls.js) checks beyond `tenant_id`: `kitchen_role`.
 *
 * @param {{ stationId: string, tenantId: string }} args
 * @returns {Promise<string>}
 */
export async function signKitchenRealtimeToken({ stationId, tenantId }) {
    return signRealtimeToken({
        subject: stationId,
        tenantId,
        claims: { kitchen_role: 'kitchen' },
        ttlSeconds: REALTIME_JWT_TTL_SECONDS
    });
}
