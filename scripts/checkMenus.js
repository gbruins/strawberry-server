// Live checks for menu management. Needs a throwaway server (see README) on BASE with the
// store key STORE_KEY. Run: node --require dotenv/config scripts/checkMenus.js
// Admin calls use a session cookie sealed with SESSION_COOKIE_PASSWORD. Temp rows are removed in finally.
import Iron from '@hapi/iron';
import { createCheckoutForCart } from '../server/plugins/cart/CheckoutService.js';
import db from '../server/db/knex.js';
import { buildState } from '../server/plugins/service/ServiceState.js';

global.logger = { info() {}, error() {}, warn() {}, debug() {} };

const BASE = process.env.CHECK_BASE || 'http://localhost:10077/api/v1';
const STORE = 'Basic ' + Buffer.from(`store:${process.env.CHECK_STORE_KEY || 'testkey123'}`).toString('base64');
const TAG = 'TMPTEST-MENU';
let failed = 0;
const check = (name, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if(!ok) failed++;
};

const sealed = await Iron.seal({ username: process.env.AUTH_USERNAME }, process.env.SESSION_COOKIE_PASSWORD, Iron.defaults);
const ADMIN = { Cookie: `sbsession=${sealed}` };
const STOREH = { Authorization: STORE };

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

try {
    await cleanup();

    const type = await db('product_types').where('slug', 'pizza').first('value');
    const mk = async (title, published = true) => (await db('products')
        .insert({ title: `${TAG}-${title}`, product_type: type.value, published, base_price: 1000 })
        .returning('*'))[0];
    const [pa, pb, pc] = [await mk('A'), await mk('B'), await mk('C')];
    const draftProduct = await mk('D', false);

    let r = await call('POST', '/service_menu', ADMIN, { title: `${TAG}-menu`, published: true });
    const menu = r.data;
    check('create menu', r.status === 200 && !!menu?.id);
    const [{ id: draftId }] = await db('service_menus').insert({ title: `${TAG}-draft`, published: false }).returning('id');

    r = await call('PUT', `/service_menu/products?id=${menu.id}`, ADMIN, { product_ids: [pc.id, pa.id, pb.id, draftProduct.id] });
    check('set products in order', r.status === 200 && r.data.map((p) => p.id).join() === [pc.id, pa.id, pb.id, draftProduct.id].join());

    r = await call('PUT', `/service_menu/products?id=${menu.id}`, ADMIN, { product_ids: [pa.id, pa.id] });
    check('duplicate product rejected', r.status === 400);
    r = await call('PUT', `/service_menu/products?id=${menu.id}`, ADMIN, { product_ids: [crypto.randomUUID()] });
    check('unknown product rejected', r.status === 400);
    r = await call('PUT', `/service_menu/products?id=${menu.id}`, STOREH, { product_ids: [] });
    check('store key cannot write products', r.status === 401);

    r = await call('GET', `/service_menu/products?id=${menu.id}`, ADMIN);
    check('admin sees draft products with flag', r.data.length === 4 && r.data.some((p) => p.id === draftProduct.id && p.published === false));
    r = await call('GET', `/service_menu/products?id=${menu.id}`, STOREH);
    check('store sees published products in order', r.data.map((p) => p.id).join() === [pc.id, pa.id, pb.id].join());

    // Unordered product sorts last
    await db('service_menu_products').insert({ service_menu_id: menu.id, product_id: (await mk('Z')).id });
    r = await call('GET', `/service_menu/products?id=${menu.id}`, STOREH);
    check('unordered product sorts last', r.data.at(-1).title === `${TAG}-Z`);

    // Moving one product
    await call('PUT', `/service_menu/products?id=${menu.id}`, ADMIN, { product_ids: [pa.id, pc.id, pb.id] });
    r = await call('GET', `/service_menu/products?id=${menu.id}`, STOREH);
    check('reorder applies', r.data.map((p) => p.id).join() === [pa.id, pc.id, pb.id].join());

    // List counts and usage
    const [svc] = await db('service').insert({
        start_at: new Date(Date.now() - 3600e3), end_at: new Date(Date.now() + 3600e3),
        notes: `${TAG}-svc`, inventory_count: 5, max_per_order: 4, service_menu_id: menu.id
    }).returning('*');
    r = await call('GET', `/service_menus?title=${TAG}-menu`, ADMIN);
    const row = (r.data?.data || r.data).find((m) => m.id === menu.id);
    check('list has product_count and services', row?.product_count === 3 && row.services?.[0]?.id === svc.id);
    r = await call('GET', `/service_menu/usage?id=${menu.id}`, ADMIN);
    check('usage names the service', r.data?.services?.[0]?.id === svc.id);

    // Store key filtering
    r = await call('GET', `/service_menu?id=${draftId}`, STOREH);
    check('store: draft menu is 404', r.status === 404);
    r = await call('GET', `/service_menu?id=${draftId}`, ADMIN);
    check('admin: draft menu readable', r.status === 200);
    r = await call('GET', '/service_menus', STOREH);
    check('store list has no drafts', (r.data?.data || r.data).every((m) => m.published));
    r = await call('GET', `/service_menu/products?id=${draftId}`, STOREH);
    check('store: draft menu products 404', r.status === 404);

    // Storefront state follows the menu order (a 2031 service avoids real data)
    await db('service').insert({
        start_at: '2031-03-08T18:00:00Z', end_at: '2031-03-08T22:00:00Z',
        notes: `${TAG}-2031`, inventory_count: 5, max_per_order: 4, service_menu_id: menu.id
    });
    const state = await buildState(new Date('2031-03-08T19:00:00Z'));
    check('state uses menu order', state.menu?.id === menu.id && state.menu.products.map((p) => p.id).join() === [pa.id, pc.id, pb.id].join());

    // Checkout refuses an item that is not on the service's published menu (FR-008a)
    const [svc2031] = await db('service').where('notes', `${TAG}-2031`).select('id');
    const [cart] = await db('carts').insert({ currency: 'usd', service_id: svc2031.id }).returning('id');
    await db('cart_items').insert({ cart_id: cart.id, qty: 1, product: { id: draftProduct.id, title: `${TAG}-D` } });
    const outsider = await mk('Outsider');
    await db('cart_items').where({ cart_id: cart.id }).update({ product: { id: outsider.id, title: outsider.title } });
    let msg = '';
    try { await createCheckoutForCart(cart.id); } catch(err) { msg = err.message; }
    check('checkout refuses item not on menu, naming it', msg === `"${outsider.title}" is no longer available`);

    // Delete still allowed while in use
    r = await call('DELETE', `/service_menu?id=${menu.id}`, ADMIN);
    check('delete allowed while in use', r.status === 200);
    const after = await buildState(new Date('2031-03-08T19:00:00Z'));
    check('state has no menu after delete', after.menu == null);
}
finally {
    await cleanup();
    const left = await db('service_menus').where('title', 'like', `${TAG}%`).count({ c: '*' }).first();
    console.log(`leftover menus: ${left.c}`);
    await db.destroy();
}

process.exit(failed ? 1 : 0);
