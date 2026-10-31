import ServiceModel from './ServiceModel.js';
import BaseService from '../base/BaseService.js';
import db from '../../db/knex.js';
import { makeArray } from '../../utils/utils.js';

export default class ServiceService extends BaseService {

    constructor() {
        super(new ServiceModel());
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
