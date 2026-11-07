import { formatInTimeZone } from 'date-fns-tz';
import db from '../../db/knex.js';

const CODE_START = 100;
const CODE_RANGE = 900; // 100-999 inclusive

/**
 * Atomically allocates the next 3-digit pickup code for a tenant's local calendar day.
 * The single upsert statement's row-level lock is what makes this race-safe: two concurrent
 * webhook deliveries for the same tenant serialize on this one statement rather than needing a
 * random-code retry loop. The day boundary is the tenant's own local midnight (timezone), not
 * UTC, so the reset lines up with when the shop actually closes/reopens.
 *
 * Wraps back to 100 after 900 orders in one tenant-day (CODE_RANGE) — intentionally accepted as
 * a documented edge case rather than guarded against, since no single pizza shop is expected to
 * clear 900 orders in a day.
 *
 * @returns {Promise<{ code: number, date: string }>}
 */
export async function allocatePickupCode(tenantId, timezone, trx = db, now = new Date()) {
    const date = formatInTimeZone(now, timezone, 'yyyy-MM-dd');

    const { rows } = await trx.raw(`
        INSERT INTO tenant_pickup_counters (tenant_id, counter_date, last_code)
        VALUES (?, ?, 1)
        ON CONFLICT (tenant_id, counter_date)
        DO UPDATE SET last_code = tenant_pickup_counters.last_code + 1
        RETURNING last_code
    `, [tenantId, date]);

    const code = CODE_START + ((rows[0].last_code - 1) % CODE_RANGE);

    return { code, date };
}
