import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import BaseService from '../base/BaseService.js';
import KitchenStationModel from './KitchenStationModel.js';
import db from '../../db/knex.js';

// Avoids 0/O and 1/I — this is read off a kitchen tablet, sometimes handwritten by an owner
// setting up a new station, so visually-ambiguous characters are worth the smaller alphabet.
const STATION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STATION_CODE_LENGTH = 6;
const SESSION_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // one shift

function generateStationCode() {
    let code = '';

    for (let i = 0; i < STATION_CODE_LENGTH; i++) {
        code += STATION_CODE_ALPHABET[crypto.randomInt(STATION_CODE_ALPHABET.length)];
    }

    return code;
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

const UNIQUE_VIOLATION = '23505';

export default class KitchenStationService extends BaseService {

    constructor() {
        super(new KitchenStationModel());
    }


    /**
     * Creates a station under the caller's own resolved tenant (never client-settable — same
     * rule as every other BaseService.create() caller). `pin` is the owner-chosen PIN; only its
     * bcrypt hash is ever persisted. Returns the plaintext station_code (not secret on its own —
     * knowing it alone grants nothing without the PIN — but there's no DB column holding it
     * in plaintext to read back out beyond the row itself).
     *
     * @returns {Promise<{ id: string, name: string, station_code: string }>}
     */
    async createStation({ tenantId, name, pin, trx = db }) {
        const pinHash = await bcrypt.hash(pin, 10);

        // Retried rather than pre-checked-then-inserted: a pre-check has a race between two
        // concurrent creations picking the same code, same reasoning as apiKeyIsValid's
        // bcrypt-loop-over-all-rows pattern elsewhere in this codebase preferring correctness
        // over a theoretically faster lookup. station_code's own UNIQUE constraint
        // (20261102120200_kitchen_stations.js) is what actually prevents a collision.
        for (let attempt = 0; attempt < 5; attempt++) {
            const stationCode = generateStationCode();

            try {
                const [row] = await trx('kitchen_stations')
                    .insert({ tenant_id: tenantId, name, station_code: stationCode, pin_hash: pinHash })
                    .returning(['id', 'name', 'station_code']);

                return row;
            }
            catch (err) {
                if (err.code !== UNIQUE_VIOLATION) {
                    throw err;
                }
            }
        }

        throw new Error('Could not generate a unique station code');
    }


    /**
     * Rotates a station's PIN and forces any existing session to re-login (turnover case — an
     * ex-staff member's tablet should not keep working just because it was never logged out).
     */
    async rotatePin({ id, pin, trx = db }) {
        const pinHash = await bcrypt.hash(pin, 10);

        await trx('kitchen_stations')
            .where({ id })
            .update({ pin_hash: pinHash, session_token_hash: null, session_expires_at: null });
    }


    async revoke({ id, trx = db }) {
        await trx('kitchen_stations')
            .where({ id })
            .update({ revoked_at: trx.fn.now(), session_token_hash: null, session_expires_at: null });
    }


    /**
     * Looks up a station by its public code with no tenant context yet (the login request is
     * the thing that establishes which tenant this is) — relies on kitchen_stations' app_select
     * RLS policy (20261102120200_kitchen_stations.js), same as AuthService.apiKeyIsValid relies
     * on tenant_api_keys'. Deliberately runs against the bare `db` connection, never a trx.
     */
    async findActiveByCode(stationCode) {
        return db('kitchen_stations')
            .where({ station_code: stationCode })
            .whereNull('revoked_at')
            .first();
    }


    /**
     * Verifies a PIN against the given (already-identified) station.
     */
    async verifyPin(stationId, pin, trx = db) {
        const row = await trx('kitchen_stations').where({ id: stationId }).whereNull('revoked_at').first('pin_hash');
        return !!row && bcrypt.compare(pin, row.pin_hash);
    }


    /**
     * Issues a new opaque session token for a station whose PIN was just verified. Only the
     * bcrypt hash is persisted — same pattern as CartService.createWithToken's cart_token.
     * This write needs the tenant GUC set to the station's own tenant_id even though the login
     * request itself carries no auth credentials yet to have had onPreHandler set it — callers
     * must open/scope `trx` for that themselves (see KitchenStationController.sessionHandler).
     *
     * @returns {Promise<string>} the plaintext token, given to the caller exactly once
     */
    async issueSession(stationId, trx) {
        const token = crypto.randomBytes(32).toString('base64url');

        await trx('kitchen_stations')
            .where({ id: stationId })
            .update({
                session_token_hash: hashToken(token),
                session_expires_at: new Date(Date.now() + SESSION_TOKEN_TTL_MS)
            });

        return token;
    }


    /**
     * Validates an opaque station_session_token against every active station — same
     * bcrypt-loop-over-all-rows shape as AuthService.apiKeyIsValid, fine at the handful-of-
     * stations-per-tenant scale this is built for. Runs with no tenant context (this IS how
     * tenant context gets resolved for the request), relying on the app_select policy.
     *
     * @returns {Promise<{ id: string, tenant_id: string, name: string }|null>}
     */
    async validateSessionToken(token) {
        if (!token) {
            return null;
        }

        const candidates = await db('kitchen_stations')
            .select('id', 'tenant_id', 'name', 'session_token_hash')
            .whereNull('revoked_at')
            .where('session_expires_at', '>', db.fn.now());

        const actual = Buffer.from(hashToken(token), 'hex');

        for (const row of candidates) {
            if (!row.session_token_hash) {
                continue;
            }

            // Same constant-time comparison as CartService.checkToken, for the same reason:
            // this runs on every kitchen-board request, so a timing side-channel across the
            // whole loop would be live far more often than the login-only cart token is.
            const expected = Buffer.from(row.session_token_hash, 'hex');

            if (expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) {
                return { id: row.id, tenant_id: row.tenant_id, name: row.name };
            }
        }

        return null;
    }

}
