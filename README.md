# strawberry-server

## Local development

Use a tool like `mkcert` to generate a trusted local SSL cert. It's free, one-time setup, and makes your dev environment match production.

Steps on macOS (since you're using /etc/hosts):

Install mkcert:
```
brew install mkcert
brew install nss  # For Firefox support, optional
```

Create your local CA (run once):
```
mkcert -install
```

Generate certs for your domain:
```
mkcert strawberry.local localhost 127.0.0.1
```

This creates strawberry.local+2.pem and strawberry.local+2-key.pem.

### For the UI
Update `vite.config.js`
```
export default {
  server: {
    host: 'strawberry.local',
    https: {
      key: fs.readFileSync(path.resolve('./strawberry.local+2-key.pem')),
      cert: fs.readFileSync(path.resolve('./strawberry.local+2.pem')),
    },
    port: 5173,
  },
};
```

### For your Hapi.js API server (assuming it's on a different port, e.g., 3000):
Use Hapi's hapi-ssl or built-in TLS:
```
const fs = require('fs');
const Hapi = require('@hapi/hapi');

const server = Hapi.server({
  host: 'strawberry.local',
  port: 3000,
  tls: {
    key: fs.readFileSync('./strawberry.local+2-key.pem'),
    cert: fs.readFileSync('./strawberry.local+2.pem'),
  },
});
```

### API server TLS behavior (server/index.js)

The API server now only loads the local TLS certificate when running in development. `server/index.js` will attach the `tls` option only when `process.env.NODE_ENV === 'development'`.

- To run the server with local TLS (development), place your generated cert files (`strawberry.local+2.pem` and `strawberry.local+2-key.pem`) in the project root (one level above the `server/` directory) so the server can read them via `path.resolve('../strawberry.local+2.pem')`.
- Start in development mode (TLS enabled), make sure the .env file is updated with:
```bash
NODE_ENV=development
```
- Start in production mode (TLS disabled — use your platform or reverse proxy for TLS), add this to .env
```bash
NODE_ENV=production
```

This keeps local development convenient (with mkcert-generated certs) while ensuring production deployments rely on proper platform-managed TLS.

## Checkout (Stripe)

`POST /api/v1/cart/checkout` (store API key + `X-Cart-Token`) creates a Stripe-hosted Checkout Session from the cart's current product prices and returns `{ url }`. The cart is closed, and its tax, billing details and Stripe ids are set, only by the signed webhook `POST /api/v1/stripe/webhook`.

Environment variables:
```bash
STOREFRONT_URL=http://localhost:5173   # where Stripe redirects after payment
STRIPE_WEBHOOK_SECRET=whsec_...        # signing secret of the webhook endpoint
STRIPE_AUTOMATIC_TAX=true              # optional; requires Stripe Tax to be set up
```

Register `https://<api host>/api/v1/stripe/webhook` in the Stripe dashboard for `checkout.session.completed`. Only cards are accepted, so a completed session is always paid. For local development: `stripe listen --forward-to localhost:10000/api/v1/stripe/webhook`.

## Services (shop open windows)

Store callers (Basic auth with the store API key) read the next service; admins manage services through `/service` and `/services`.

| Route | Purpose |
|-------|---------|
| `GET /api/v1/services/next` | Current or next service: `status` (`open`, `sold_out`, `upcoming`, `none`), `server_now`, `remaining`, the published menu, and `next_service` when sold out |
| `GET /api/v1/services/next/stream` | Server-Sent Events. Sends the full state as an `update` event on connect and whenever it changes |

- All timestamps are UTC ISO-8601; the UIs display them in America/Los_Angeles.
- `remaining` is `inventory_count` minus pizzas on paid carts minus pizzas held by live checkouts. Only products whose product type slug is `pizza` count.
- A checkout holds its pizzas until the Stripe session expires plus 60 seconds (`carts.checkout_expires_at`). Cancel, expiry and payment all release or finalize the hold.
- `max_per_order` (minimum 1) caps pizzas per cart: `min(max_per_order, remaining)`.
- Carts whose service has ended and that have no live hold are emptied on next access; the response includes `cart_reset: "service_ended"` once.

### Stream behavior and operations

- State is re-evaluated every 3 seconds and also pushed immediately on checkout cancel and completion. A `: ping` comment is sent every 25 seconds.
- `SERVICE_STREAMS_PER_IP` (default `50`) limits concurrent streams per client IP; extra connections get `429`.
- The per-IP limit uses the connection's remote address. Behind a reverse proxy or load balancer, configure Hapi `trustProxy`/forwarded-IP handling or every client will share the proxy's IP and hit the limit.
- Proxies must not buffer or compress the stream. The route sends `X-Accel-Buffering: no`, `Cache-Control: no-cache` and `Content-Encoding: identity`; for nginx also set `proxy_buffering off` and a long `proxy_read_timeout`.
- The stream hub is in-process. Running more than one server instance needs Postgres `LISTEN/NOTIFY` (or similar) so instances share change events.
- `node --require dotenv/config scripts/checkServiceState.js` checks the state boundaries against the dev DB using temporary rows.

## Service menus

A service uses one menu, which is an ordered list of products.

- `GET /service_menus` and `GET /service_menu?id=` accept the store key but only return published menus. Drafts are admin only.
- `GET /service_menu/products?id=` lists a menu's products in display order. Store callers only get published products.
- `PUT /service_menu/products?id=` (admin) replaces a menu's products and order with `{ "product_ids": [...] }`. The array order is the display order.
- `GET /service_menu/usage?id=` (admin) lists open or upcoming services that use the menu. The list endpoint also returns `product_count` and `services` for each menu.
- Deleting a menu is never blocked. Services that used it show no menu.
- Checkout refuses a cart item that is not on the service's current published menu.
- Order is stored in `service_menu_products.ordinal`. Products without one sort last, by title.

Verify with `node --require dotenv/config scripts/checkMenus.js` against a throwaway server on port 10077 (`CORS_ORIGINS` and `SESSION_COOKIE_SECURE=false` are not needed for the script).
