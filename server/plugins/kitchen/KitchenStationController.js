import bcrypt from 'bcryptjs';
import Boom from '@hapi/boom';
import BaseController from '../base/BaseController.js';
import KitchenStationService from './KitchenStationService.js';
import db from '../../db/knex.js';
import { signKitchenRealtimeToken } from './realtimeToken.js';

export default class KitchenStationController extends BaseController {

    constructor() {
        super(new KitchenStationService());
    }


    /**
     * POST /kitchen/session — the only kitchen route with `auth: false`. No ambient trx exists
     * yet (onPreHandler never runs a transaction for an unauthenticated route), so this opens
     * its own, scoped to the station's own tenant_id once that's known from station_code — the
     * same shape as onPreHandler's own set_config call, just invoked manually because this is
     * the one place that resolves tenant_id outside of the normal auth-strategy path.
     */
    async sessionHandler(request, h) {
        try {
            const { station_code, pin } = request.payload;
            const station = await this.service.findActiveByCode(station_code);

            // Same response for an unknown code and a wrong PIN — don't let this endpoint be
            // used to probe which station codes exist.
            if (!station || !(await bcrypt.compare(pin, station.pin_hash))) {
                throw Boom.unauthorized('Invalid station code or PIN');
            }

            const { token, tenantName } = await db.transaction(async (trx) => {
                await trx.raw('SELECT set_config(?, ?, true)', ['app.current_tenant_id', station.tenant_id]);

                const sessionToken = await this.service.issueSession(station.id, trx);
                const tenant = await trx('tenants').where({ id: station.tenant_id }).first('name');

                return { token: sessionToken, tenantName: tenant?.name };
            });

            return h.apiSuccess({
                station_session_token: token,
                tenant_id: station.tenant_id,
                tenant_name: tenantName,
                station_name: station.name,
                // Login must still succeed if Realtime JWT signing fails (e.g.
                // SUPABASE_JWT_SECRET not yet configured) — the board can fall back to polling
                // GET /kitchen/tickets; a working login is more important than live updates.
                realtime_jwt: await this.signRealtimeTokenOrNull(station)
            });
        }
        catch (err) {
            if (err.isBoom) {
                throw err;
            }

            global.logger.error(err);
            throw Boom.badRequest(err.message);
        }
    }


    /**
     * POST /kitchen/session/verify-pin — backs the board's idle-lock overlay. Re-checks the PIN
     * against the already-identified station (stationBearer credentials) without touching the
     * session token at all — locking/unlocking never re-issues or extends the 12h session.
     */
    async verifyPinHandler(request, h) {
        try {
            const valid = await this.service.verifyPin(
                request.auth.credentials.station_id,
                request.payload.pin,
                request.app.trx
            );

            return h.apiSuccess({ valid });
        }
        catch (err) {
            global.logger.error(err);
            throw Boom.badRequest(err.message);
        }
    }


    /**
     * POST /kitchen/session/refresh — reissues only the short-lived Realtime JWT, called
     * periodically while the board tab stays open. Never touches station_session_token/
     * session_expires_at — that's the 12h shift session, independent of this.
     */
    async refreshHandler(request, h) {
        return h.apiSuccess({
            realtime_jwt: await this.signRealtimeTokenOrNull({
                id: request.auth.credentials.station_id,
                tenant_id: request.auth.credentials.tenant_id
            })
        });
    }


    async signRealtimeTokenOrNull(station) {
        try {
            return await signKitchenRealtimeToken({ stationId: station.id, tenantId: station.tenant_id });
        }
        catch (err) {
            global.logger.error(err, { meta: { stationId: station.id } });
            return null;
        }
    }


    /**
     * POST /kitchen/stations — owner-facing (adminBearer only). The owner chooses the PIN
     * themselves (this is a shared-station login, not a generated secret the owner has to
     * relay) — only station_code is server-generated and returned.
     */
    async createStationHandler(request, h) {
        try {
            const station = await this.service.createStation({
                tenantId: request.app.tenantId,
                name: request.payload.name,
                pin: request.payload.pin,
                trx: request.app.trx
            });

            return h.apiSuccess(station);
        }
        catch (err) {
            global.logger.error(err);
            throw Boom.badRequest(err.message);
        }
    }


    /**
     * PUT /kitchen/stations/rotate-pin — owner-facing. Also invalidates any current session
     * (KitchenStationService.rotatePin) so a staff turnover can't leave an old tablet logged in
     * under the new PIN's station identity.
     */
    async rotatePinHandler(request, h) {
        try {
            await this.throwIfNotFound(request.payload.id, request);
            await this.service.rotatePin({ id: request.payload.id, pin: request.payload.pin, trx: request.app.trx });

            return h.apiSuccess({ id: request.payload.id });
        }
        catch (err) {
            if (err.isBoom) {
                throw err;
            }

            global.logger.error(err);
            throw Boom.badRequest(err.message);
        }
    }


    /**
     * DELETE /kitchen/stations — owner-facing. A revoke, not a hard delete (kitchen_stations has
     * no soft-delete column of its own) — immediately invalidates any live session token too.
     */
    async revokeHandler(request, h) {
        try {
            await this.throwIfNotFound(request.query.id, request);
            await this.service.revoke({ id: request.query.id, trx: request.app.trx });

            return h.apiSuccess({ id: request.query.id });
        }
        catch (err) {
            if (err.isBoom) {
                throw err;
            }

            global.logger.error(err);
            throw Boom.badRequest(err.message);
        }
    }

}
