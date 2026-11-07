import { expect } from '@hapi/code';
import Lab from '@hapi/lab';
import { init } from '../../../index.js';
import { createTestTenant, ownerQuery } from '../../../utils/testHelpers.js';
import db from '../../../db/knex.js';

export const lab = Lab.script();
const { describe, it, before, after } = lab;

// Found by a real user hitting this live: migration 96 (specs/004-multi-tenant-supabase) added
// a NOT NULL tenant_id + RLS policy to service_menu_products, but ServiceMenuService.setProducts()
// was never updated to actually set tenant_id on the rows it inserts — every save of a menu's
// product list failed with a 500 (RLS WITH CHECK / NOT NULL violation at the DB layer, uncaught).
// No test existed for this endpoint at all, which is why the migration shipped broken.
describe('PUT /api/v1/service_menu/products', () => {
    let server;
    let tenant;
    let menu;
    let productA;
    let productB;

    function adminAuth(tenantId) {
        return { strategy: 'adminBearer', credentials: { tenant_id: tenantId, role: 'owner', is_platform_staff: false } };
    }

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenant = await createTestTenant({ name: 'ServiceMenuProducts test tenant' });

        [menu] = await ownerQuery('service_menus').insert({ tenant_id: tenant.tenantId, title: 'Test Menu', published: true }).returning('*');
        [productA] = await ownerQuery('products').insert({ tenant_id: tenant.tenantId, title: 'Cheese Pizza', published: true, base_price: 10, product_type: tenant.pizzaType }).returning('*');
        [productB] = await ownerQuery('products').insert({ tenant_id: tenant.tenantId, title: 'Pepperoni Pizza', published: true, base_price: 12, product_type: tenant.pizzaType }).returning('*');

        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await ownerQuery('service_menu_products').where({ service_menu_id: menu.id }).del();
        await ownerQuery('service_menus').where({ id: menu.id }).del();
        await tenant.cleanup();
        await server.stop();
    });

    it('saves a product onto a menu, writing a real tenant_id (regression for the NOT NULL/RLS bug)', { timeout: 15000 }, async () => {
        const res = await server.inject({
            method: 'PUT',
            url: `/api/v1/service_menu/products?id=${menu.id}`,
            auth: adminAuth(tenant.tenantId),
            payload: { product_ids: [productA.id] }
        });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.length).to.equal(1);
        expect(res.result.data[0].id).to.equal(productA.id);

        const row = await ownerQuery('service_menu_products').where({ service_menu_id: menu.id, product_id: productA.id }).first();
        expect(row).to.exist();
        expect(row.tenant_id).to.equal(tenant.tenantId);
    });

    it('replaces the product list (not appends) and preserves the given order', { timeout: 15000 }, async () => {
        const res = await server.inject({
            method: 'PUT',
            url: `/api/v1/service_menu/products?id=${menu.id}`,
            auth: adminAuth(tenant.tenantId),
            payload: { product_ids: [productB.id, productA.id] }
        });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.map((p) => p.id)).to.equal([productB.id, productA.id]);

        const rows = await ownerQuery('service_menu_products').where({ service_menu_id: menu.id });
        expect(rows.length).to.equal(2);
        expect(rows.every((r) => r.tenant_id === tenant.tenantId)).to.equal(true);
    });

    it('clears the product list when given an empty array', { timeout: 15000 }, async () => {
        const res = await server.inject({
            method: 'PUT',
            url: `/api/v1/service_menu/products?id=${menu.id}`,
            auth: adminAuth(tenant.tenantId),
            payload: { product_ids: [] }
        });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.length).to.equal(0);

        const rows = await ownerQuery('service_menu_products').where({ service_menu_id: menu.id });
        expect(rows.length).to.equal(0);
    });
});
