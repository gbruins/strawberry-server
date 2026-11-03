import Boom from '@hapi/boom';

export default class KitchenTicketController {

    /**
     * GET /kitchen/tickets — deliberately a new, narrow query rather than a widened `/carts`
     * search: a shared kitchen tablet should never see billing/PII/Stripe fields the full admin
     * cart view exposes. Tenant scoping comes from RLS (request.app.trx's GUC), same as every
     * other tenant-scoped query — no explicit tenant_id filter needed here.
     *
     * Items come from the separate `cart_items` table, mapped the same way
     * CheckoutService.js's receipt-email payload does (`item.product?.title`, `item.qty`) —
     * `product` is a JSONB snapshot column on cart_items, not a join to `products`.
     */
    async listHandler(request, h) {
        try {
            const trx = request.app.trx;

            const tickets = await trx('carts')
                .select('id', 'pickup_code', 'kitchen_status', 'kitchen_status_updated_at', 'customer_note')
                .whereNotNull('kitchen_status')
                .whereNull('deleted_at')
                .orderBy('kitchen_status_updated_at', 'asc');

            const cartIds = tickets.map((ticket) => ticket.id);

            const items = cartIds.length
                ? await trx('cart_items')
                    .select('cart_id', 'product', 'qty')
                    .whereIn('cart_id', cartIds)
                    .whereNull('deleted_at')
                : [];

            const itemsByCartId = new Map();

            items.forEach((item) => {
                const list = itemsByCartId.get(item.cart_id) || [];
                list.push({ name: item.product?.title || 'Item', quantity: item.qty });
                itemsByCartId.set(item.cart_id, list);
            });

            tickets.forEach((ticket) => {
                ticket.items = itemsByCartId.get(ticket.id) || [];
            });

            return h.apiSuccess(tickets);
        }
        catch (err) {
            global.logger.error(err);
            throw Boom.badRequest(err.message);
        }
    }

}
