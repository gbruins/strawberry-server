import bcrypt from 'bcryptjs';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import BaseService from '../base/BaseService.js';
import db from '../../db/knex.js';

// Lazily created so a missing SUPABASE_URL doesn't crash module load before T001's project
// exists — only matters once a request actually presents a bearer token.
let _jwks;
function getJwks() {
    if (!_jwks) {
        if (!process.env.SUPABASE_URL) {
            throw new Error('SUPABASE_URL is not set');
        }
        _jwks = createRemoteJWKSet(new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
    }
    return _jwks;
}

// Distinguishes "token is invalid/expired" (401) from "token is genuinely valid but there's no
// admin_users row for this person" (403) — contracts/admin-auth.md specifies different status
// codes for these, and they need to stay distinguishable past this function's boundary (found
// by independent QA review: both cases were being collapsed into the same 401).
export class AdminUserNotFoundError extends Error {}

export default class AuthService extends BaseService {

    constructor() {
        super();
    }


    /**
     * Verifies a Supabase Auth JWT (contracts/admin-auth.md) and resolves it to this app's
     * own authorization context via the admin_users table — Supabase Auth answers "who is
     * this", admin_users answers "what tenant/role do they have" (research.md #4).
     *
     * Platform staff (`is_platform_staff = true`, `tenant_id = null`) may act "as" a tenant for
     * support via an explicit `X-Tenant-Id` header (contracts/tenant-resolution.md) — logged
     * distinctly from a normal owner request (spec Edge Cases: audit distinction). This only
     * resolves *who the request claims to act as*; whether a given ROUTE actually allows
     * impersonation at all is enforced separately in serverExtensions' onPreHandler, which has
     * access to the route's own config — AuthService has no notion of "which route is this."
     *
     * @param {string} token - the raw JWT from an `Authorization: Bearer <token>` header
     * @param {string|undefined} impersonateTenantId - the `X-Tenant-Id` header, if present
     * @returns {Promise<{id: string, tenant_id: string|null, role: string|null, is_platform_staff: boolean, impersonating: boolean}>}
     * @throws if the token is missing/invalid/expired, no matching admin_users row exists, or
     *         an `X-Tenant-Id` is given that doesn't match a real tenant
     */
    async verifyAdminToken(token, impersonateTenantId) {
        const { payload } = await jwtVerify(token, getJwks(), {
            issuer: `${process.env.SUPABASE_URL}/auth/v1`,
            audience: process.env.SUPABASE_JWT_AUD || 'authenticated'
        });

        const adminUser = await db('admin_users')
            .select('tenant_id', 'role', 'is_platform_staff')
            .where({ id: payload.sub })
            .first();

        if (!adminUser) {
            throw new AdminUserNotFoundError(`No admin_users row for Supabase user ${payload.sub}`);
        }

        // Owners already have exactly one tenant — an X-Tenant-Id header from a non-platform-
        // staff account is simply ignored, never honored, regardless of its value.
        if (adminUser.tenant_id || !adminUser.is_platform_staff || !impersonateTenantId) {
            return { id: payload.sub, ...adminUser, impersonating: false };
        }

        const targetTenant = await db('tenants').select('id').where({ id: impersonateTenantId }).first();

        if (!targetTenant) {
            throw new AdminUserNotFoundError(`X-Tenant-Id ${impersonateTenantId} does not match a real tenant`);
        }

        global.logger.info('Platform staff impersonation', {
            meta: { platformStaffId: payload.sub, actingAsTenantId: impersonateTenantId }
        });

        return {
            id: payload.sub,
            tenant_id: impersonateTenantId,
            role: adminUser.role,
            is_platform_staff: true,
            impersonating: true
        };
    }


    async getTenant(tenantId) {
        if (!tenantId) {
            return null;
        }

        const tenant = await db('tenants').select('name', 'timezone').where({ id: tenantId }).first();
        return tenant || null;
    }


    /**
     * Validates a storefront's Basic-auth API key and resolves which tenant it belongs to —
     * the key alone identifies the tenant, no domain/hostname involved (research.md #9). bcrypt
     * hashes are salted per-hash, so the matching key can't be looked up by equality; every
     * active key is compared in turn (fine at the staff-provisioned scale this is built for —
     * FR-007).
     *
     * @returns {Promise<{isValid: boolean, tenantId: string|null}>}
     */
    async apiKeyIsValid(userId, apiKey) {
        try {
            if (!userId || !apiKey) {
                global.logger.error('AuthService:apiKeyIsValid - FAILED');
                return { isValid: false, tenantId: null };
            }

            const activeKeys = await db('tenant_api_keys')
                .select('tenant_id', 'key_hash')
                .whereNull('revoked_at');

            for (const row of activeKeys) {
                if (await bcrypt.compare(apiKey, row.key_hash)) {
                    return { isValid: true, tenantId: row.tenant_id };
                }
            }

            global.logger.error('AuthService:apiKeyIsValid - FAILED - no active key matched');
            return { isValid: false, tenantId: null };
        }
        catch(err) {
            global.logger.error(err);
            return { isValid: false, tenantId: null };
        }
    }

}
