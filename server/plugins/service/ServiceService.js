import Joi from 'joi';
import Boom from '@hapi/boom';
import ServiceModel from './ServiceModel.js';
import BaseService from '../base/BaseService.js';
import db from '../../db/knex.js';
import { makeArray } from '../../utils/utils.js';

export default class ServiceService extends BaseService {

    constructor() {
        super(new ServiceModel());
    }

    // Same pattern as CartService's override: the base schema's plain Joi.date() only accepts
    // an actual date value, but ServicesPage's "Ends after" filter sends a BaseService filter
    // object (e.g. end_at={"gte":"<iso>"}) — Joi.object() with no keys auto-JSON-parses a
    // string value and accepts any resulting object, which is what makes that filter shape
    // validate at all.
    getValidationSchemaForSearch() {
        const schema = {
            ...super.getValidationSchemaForSearch()
        };

        schema.start_at = Joi.alternatives().try(Joi.date(), Joi.object(), Joi.allow(null));
        schema.end_at = Joi.alternatives().try(Joi.date(), Joi.object(), Joi.allow(null));

        return schema;
    }

    /**
     * Rejects a create/update whose [start_at, end_at] window overlaps any other service for
     * this tenant. Skipped when either boundary is null — an unbounded window can't be
     * meaningfully checked, and the admin UI's own form validation already requires both
     * before a human can submit anyway. Touching boundaries (one service ending exactly when
     * another starts) are NOT treated as an overlap — standard half-open interval semantics.
     *
     * @param {{ id?: string, start_at: string|Date|null, end_at: string|Date|null }} data
     * @param {import('knex').Knex} trx - must be the same trx the write itself runs in, so
     *   this sees the tenant-scoped rows RLS resolves for the caller's own tenant.
     */
    async assertNoOverlap({ id, start_at, end_at }, trx = db) {
        if (!start_at || !end_at) {
            return;
        }

        const qb = trx(this.model.tableName)
            .whereNotNull('start_at')
            .whereNotNull('end_at')
            .where('start_at', '<', end_at)
            .where('end_at', '>', start_at);

        if (id) {
            qb.whereNot('id', id);
        }

        const conflict = await qb.first('id');

        if (conflict) {
            throw Boom.badRequest('This service window overlaps with an existing service');
        }
    }

    async create(config) {
        await this.assertNoOverlap(config.data || {}, config.trx);
        return super.create(config);
    }

    async update(config) {
        const data = { ...config.data, id: config.where?.id };

        // A caller could PUT a partial payload omitting start_at/end_at (the model schema
        // allows it) — fall back to the current row's own values so the overlap check still
        // has both boundaries instead of skipping the check entirely.
        if (data.start_at === undefined || data.end_at === undefined) {
            const current = await (config.trx || db)(this.model.tableName)
                .where({ id: data.id })
                .first('start_at', 'end_at');

            if (data.start_at === undefined) {
                data.start_at = current?.start_at ?? null;
            }
            if (data.end_at === undefined) {
                data.end_at = current?.end_at ?? null;
            }
        }

        await this.assertNoOverlap(data, config.trx);
        return super.update(config);
    }

    /**
     * Attaches last_notified_at (specs/005-email-open-alerts, FR-007) — derived from
     * notification_sends, not stored on this table (data-model.md). Read-path only: nothing
     * in create()/update() touches this, so creating or editing a service never implies or
     * triggers a send (FR-006).
     */
    async addRelations(results, trx = db) {
        const services = makeArray(results);
        const ids = services.map((s) => s.id).filter(Boolean);

        if (!ids.length) {
            return results;
        }

        const rows = await trx('notification_sends')
            .whereIn('service_id', ids)
            .groupBy('service_id')
            .select('service_id')
            .max('sent_at as last_notified_at');

        const byServiceId = new Map(rows.map((r) => [r.service_id, r.last_notified_at]));
        services.forEach((s) => { s.last_notified_at = byServiceId.get(s.id) ?? null; });

        return results;
    }
}
