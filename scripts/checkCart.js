// Live checks for the cart and checkout rules behind the storefront cart (spec 003).
// Needs a throwaway server on CHECK_BASE started with STOREFRONT_URL and Stripe test keys,
// and the store key CHECK_STORE_KEY. Run: node --require dotenv/config scripts/checkCart.js
// Temp rows (TMPTEST-CART) are removed in finally and open test sessions are expired.
import Iron from '@hapi/iron';
import StripeService from '../server/plugins/stripe/StripeService.js';
import db from '../server/db/knex.js';

global.logger = { info() {}, error() {}, warn() {}, debug() {} };

const BASE = process.env.CHECK_BASE || 'http://localhost:10077/api/v1';
const STORE = 'Basic ' + Buffer.from(`store:${process.env.CHECK_STORE_KEY || 'testkey123'}`).toString('base64');
const TAG = 'TMPTEST-CART';
let failed = 0;
const check = (name, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if(!ok) failed++;
};

const sealed = await Iron.seal({ username: process.env.AUTH_USERNAME }, process.env.SESSION_COOKIE_PASSWORD, Iron.defaults);
const ADMIN = { Cookie: `sbsession=${sealed}` };
const storeHeaders = (token) => ({ Authorization: STORE, ...(token ? { 'x-cart-token': token } : {}) });

const call = async (method, path, headers, body) => {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: json, data: json?.data ?? json };
};

const sessions = [];

const cleanup = async () => {
    const menus = db('service_menus').where('title', 'like', `${TAG}%`).select('id');
    const svcs = db('service').where('notes', 'like', `${TAG}%`).select('id');
    const carts = db('carts').whereIn('service_id', svcs).select('id');
    await db('cart_items').whereIn('cart_id', carts).del();
    await db('carts').whereIn('service_id', svcs).del();
    await db('service').where('notes', 'like', `${TAG}%`).del();
    await db('service_menu_products').whereIn('service_menu_id', menus).del();
    await db('service_menus').where('title', 'like', `${TAG}%`).del();
    await db('products').where('title', 'like', `${TAG}%`).del();
};

const newCart = async (serviceId) => {
    const r = await call('POST', '/cart', storeHeaders(), {});
    await db('carts').where({ id: r.data.id }).update({ service_id: serviceId });
    return { id: r.data.id, token: r.data.cart_token };
};

try {
    await cleanup();

    const type = await db('product_types').where('slug', 'pizza').first('value');
    const mk = async (title, price) => (await db('products')
        .insert({ title: `${TAG}-${title}`, product_type: type.value, published: true, base_price: price })
        .returning('*'))[0];
    const [pa, pb] = [await mk('A', 1000), await mk('B', 1200)];

    const [menu] = await db('service_menus').insert({ title: `${TAG}-menu`, published: true }).returning('*');
    await db('service_menu_products').insert([
        { service_menu_id: menu.id, product_id: pa.id, ordinal: 1 },
        { service_menu_id: menu.id, product_id: pb.id, ordinal: 2 }
    ]);

    const now = Date.now();
    const [service] = await db('service').insert({
        start_at: new Date(now - 3600e3), end_at: new Date(now + 2 * 3600e3),
        inventory_count: 10, max_per_order: 4, service_menu_id: menu.id, notes: `${TAG}-svc`
    }).returning('*');

    // Current prices
    const cart = await newCart(service.id);
    const H = storeHeaders(cart.token);
    let r = await call('POST', '/cart/item', H, { cart_id: cart.id, product_id: pa.id, qty: 2 });
    check('add item', r.status === 200);
    r = await call('GET', `/cart?id=${cart.id}`, H);
    check('cart read shows price 1000 x 2', r.data.cart_items[0].price_subtotal === 2000 && r.data.price_subtotal === 2000);
    await db('products').where({ id: pa.id }).update({ base_price: 1500, title: `${TAG}-A2` });
    r = await call('GET', `/cart?id=${cart.id}`, H);
    check('cart read follows a price change', r.data.price_subtotal === 3000 && r.data.cart_items[0].product.title === `${TAG}-A2`);

    // Customer note
    r = await call('PUT', '/cart/customer_note', H, { id: cart.id, customer_note: ' no olives ' });
    check('note saves and is trimmed', r.status === 200 && r.data.customer_note === 'no olives');
    r = await call('PUT', '/cart/customer_note', H, { id: cart.id, customer_note: 'x'.repeat(501) });
    check('501 character note rejected', r.status === 400);
    r = await call('GET', `/cart?id=${cart.id}`, H);
    check('note unchanged after rejection', r.data.customer_note === 'no olives');
    check('store view hides admin_order_notes', !('admin_order_notes' in r.data));
    const other = await newCart(service.id);
    r = await call('PUT', '/cart/customer_note', storeHeaders(other.token), { id: cart.id, customer_note: 'hijack' });
    check('another cart token cannot write the note', r.status === 404);
    r = await call('PUT', '/cart/customer_note', H, { id: cart.id, customer_note: '' });
    check('empty note clears it', r.status === 200 && r.data.customer_note === null);
    await call('PUT', '/cart/customer_note', H, { id: cart.id, customer_note: 'thin crust' });

    // Checkout: parallel requests, one session
    r = await call('GET', `/cart?id=${cart.id}`, H);
    check('not in progress before checkout', r.data.checkout_in_progress === false);
    const [c1, c2] = await Promise.all([
        call('POST', '/cart/checkout', H, { id: cart.id }),
        call('POST', '/cart/checkout', H, { id: cart.id })
    ]);
    const url1 = c1.data?.url;
    check('parallel checkouts succeed', c1.status === 200 && c2.status === 200 && !!url1);
    check('parallel checkouts return one session URL', url1 === c2.data?.url);
    const sessionId = (await db('carts').where({ id: cart.id }).first('stripe_order_id')).stripe_order_id;
    sessions.push(sessionId);
    r = await call('POST', '/cart/checkout', H, { id: cart.id });
    check('later checkout returns the same URL', r.data?.url === url1);

    r = await call('GET', `/cart?id=${cart.id}`, H);
    check('in progress during checkout', r.data.checkout_in_progress === true);
    r = await call('PUT', '/cart/customer_note', H, { id: cart.id, customer_note: 'late' });
    check('note refused during checkout with a code', r.status === 409 && r.body?.data?.code === 'checkout_in_progress');
    const itemId = (await call('GET', `/cart?id=${cart.id}`, H)).data.cart_items[0].id;
    r = await call('PUT', '/cart/item', H, { id: itemId, qty: 1 });
    check('item edit refused during checkout with a code', r.status === 409 && r.body?.data?.code === 'checkout_in_progress');

    // Session expiry releases the lock
    await StripeService.expireCheckoutSession(sessionId);
    r = await call('GET', `/cart?id=${cart.id}`, H);
    check('not in progress after the session expires', r.data.checkout_in_progress === false);
    r = await call('PUT', '/cart/item', H, { id: itemId, qty: 1 });
    check('edits allowed again after expiry', r.status === 200);

    // Item taken off the menu
    await db('service_menu_products').where({ service_menu_id: menu.id, product_id: pa.id }).del();
    r = await call('POST', '/cart/checkout', H, { id: cart.id });
    const detail = r.body?.data;
    check('item off the menu gives item_unavailable', r.status === 409 && detail?.code === 'item_unavailable'
        && detail.product_id === pa.id && detail.title === `${TAG}-A2`);
    check('refusal message names the item', (r.body?.message || '').includes(`"${TAG}-A2" is no longer available`));

    // Remaining drops below the cart quantity
    await db('service_menu_products').insert({ service_menu_id: menu.id, product_id: pa.id, ordinal: 1 });
    await call('PUT', '/cart/item', H, { id: itemId, qty: 3 });
    await db('service').where({ id: service.id }).update({ inventory_count: 2 });
    r = await call('POST', '/cart/checkout', H, { id: cart.id });
    check('remaining below cart quantity gives over_limit', r.status === 409 && r.body?.data?.code === 'over_limit' && r.body.data.remaining === 2);
}
finally {
    for(const id of sessions) {
        try { await StripeService.expireCheckoutSession(id); } catch { /* already expired */ }
    }
    await cleanup();
    const left = await db('service').where('notes', 'like', `${TAG}%`).count('* as n').first();
    console.log(`leftover temp services: ${left.n}`);
    await db.destroy();
}

process.exit(failed ? 1 : 0);
