// Boundary checks for buildState. Run: node --require dotenv/config scripts/checkServiceState.js
// Uses a fake "now" in 2031 so real services never interfere; temp rows are removed in finally.
import crypto from 'node:crypto';
import db from '../server/db/knex.js';
import { buildState } from '../server/plugins/service/ServiceState.js';

const TAG = 'TMPTEST-STATE';
let failed = 0;
const check = (name, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if(!ok) failed++;
};
const at = (iso) => new Date(iso);
const cleanup = async () => {
    const services = db('service').where('notes', 'like', `${TAG}%`).select('id');
    const carts = db('carts').whereIn('service_id', services).select('id');
    await db('cart_items').whereIn('cart_id', carts).del();
    await db('carts').whereIn('service_id', services).del();
    await db('service').where('notes', 'like', `${TAG}%`).del();
};

try {
    await cleanup();

    const pizza = await db('products as p')
        .join('product_types as pt', 'pt.value', 'p.product_type')
        .where('pt.slug', 'pizza')
        .first('p.id');

    const [a] = await db('service').insert({ start_at: '2031-03-08T18:00:00Z', end_at: '2031-03-08T22:00:00Z', notes: `${TAG}-A`, inventory_count: 5, max_per_order: 4 }).returning('*');
    // B starts the instant A ends
    const [b] = await db('service').insert({ start_at: '2031-03-08T22:00:00Z', end_at: '2031-03-09T02:00:00Z', notes: `${TAG}-B`, inventory_count: 5, max_per_order: 4 }).returning('*');

    let s = await buildState(at('2031-03-08T17:59:59.999Z'));
    check('just before start_at: upcoming A', s.status === 'upcoming' && s.service.id === a.id);

    s = await buildState(at('2031-03-08T18:00:00.000Z'));
    check('exactly start_at: open', s.status === 'open' && s.service.id === a.id && s.remaining === 5);

    s = await buildState(at('2031-03-08T21:59:59.999Z'));
    check('just before end_at: still A', s.service.id === a.id && s.status === 'open');

    s = await buildState(at('2031-03-08T22:00:00.000Z'));
    check('exactly end_at: A is over, B is open', s.service.id === b.id && s.status === 'open');

    s = await buildState(at('2031-03-09T02:00:00.000Z'));
    check('after last service: none', s.status === 'none' && s.service === null);

    // US DST starts 2031-03-09 02:00 local; instants are UTC so the 4-hour window is unaffected
    const [dst] = await db('service').insert({ start_at: '2031-03-09T09:00:00Z', end_at: '2031-03-09T13:00:00Z', notes: `${TAG}-DST`, inventory_count: 5, max_per_order: 4 }).returning('*');
    s = await buildState(at('2031-03-09T10:00:00Z'));
    check('DST change day: window evaluated in UTC', s.status === 'open' && s.service.id === dst.id);

    if(pizza) {
        const product = { id: pizza.id, title: TAG };
        const now = at('2031-03-08T19:00:00Z');
        const [held] = await db('carts').insert({ currency: 'usd', service_id: a.id, checkout_expires_at: '2031-03-08T19:30:00Z' }).returning('id');
        await db('cart_items').insert({ cart_id: held.id, qty: 2, product });
        s = await buildState(now);
        check('held pizzas reduce remaining (5 -> 3)', s.remaining === 3);

        s = await buildState(at('2031-03-08T19:30:01Z'));
        check('expired hold restores remaining without any request (5)', s.remaining === 5);

        await db('carts').where({ id: held.id }).update({ checkout_expires_at: null });
        s = await buildState(now);
        check('cancelled hold restores remaining (5)', s.remaining === 5);

        await db('carts').where({ id: held.id }).update({ closed_at: '2031-03-08T19:10:00Z' });
        s = await buildState(now);
        check('paid cart counts permanently (3)', s.remaining === 3);

        await db('cart_items').where({ cart_id: held.id }).update({ qty: 9 });
        s = await buildState(now);
        check('remaining never goes below 0 and status is sold_out', s.remaining === 0 && s.status === 'sold_out');
    } else {
        console.log('SKIP  hold checks: no product with type slug "pizza" in this DB');
    }
} finally {
    await cleanup();
    const left = await db('service').where('notes', 'like', `${TAG}%`).count('* as n').first();
    console.log(`leftover temp services: ${left.n}`);
    await db.destroy();
}

process.exit(failed ? 1 : 0);
