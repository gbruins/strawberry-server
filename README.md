# strawberry-server

This is the shared backend for a multi-tenant pizza-ordering platform: one deployment serves
every tenant (each an independent pizza business with its own products, menus, service windows,
and admin accounts), isolated from each other by Postgres Row-Level Security — see
"Multi-tenancy" below for the full model and how to onboard a new tenant. Each tenant runs its
own separate storefront deployment (this organization's own is `selloutPizza`); there is no
shared multi-tenant storefront.

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

## Cart

- `GET /api/v1/cart` returns the cart with current product titles and prices, `customer_note`, and `checkout_in_progress` (read from the live Stripe session).
- `PUT /api/v1/cart/customer_note` saves the customer's note (max 500 characters).
- While a Stripe session is open the cart is locked: item edits and note changes get a 409 with `code: 'checkout_in_progress'`. Calling `POST /cart/checkout` again reuses the open session and returns its URL; cancelling releases the lock.
- `POST /cart/checkout` refusals are 409 with `data.code` of `item_unavailable` (with `product_id` and `title`), `over_limit`, `sold_out` or `no_open_service`.
- Checkout creation is serialised per cart in-process only; a multi-instance deployment needs a database lock.
- Live checks: `node --require dotenv/config scripts/checkCart.js` (needs a running server and Stripe test keys).

## Services (shop open windows)

Store callers (Basic auth with the store API key) read the next service; admins manage services through `/service` and `/services`.

| Route | Purpose |
|-------|---------|
| `GET /api/v1/services/next` | Current or next service: `status` (`open`, `sold_out`, `upcoming`, `none`), `server_now`, `remaining`, the published menu, and `next_service` when sold out |
| `GET /api/v1/services/next/stream` | Server-Sent Events. Sends the full state as an `update` event on connect and whenever it changes |

- All timestamps are UTC ISO-8601; the UIs display them in each tenant's own configured timezone (`tenants.timezone`, default America/Los_Angeles — see "Multi-tenancy" below).
- `remaining` is `inventory_count` minus pizzas on paid carts minus pizzas held by live checkouts. Only products whose product type slug is `pizza` count.
- A checkout holds its pizzas until the Stripe session expires plus 60 seconds (`carts.checkout_expires_at`). Cancel, expiry and payment all release or finalize the hold.
- `max_per_order` (minimum 1) caps pizzas per cart: `min(max_per_order, remaining)`.
- Carts whose service has ended and that have no live hold are emptied on next access; the response includes `cart_reset: "service_ended"` once.

### Stream behavior and operations

- State is re-evaluated every 3 seconds and also pushed immediately on checkout cancel and completion. A `: ping` comment is sent every 25 seconds.
- `SERVICE_STREAMS_PER_IP` (default `50`) limits concurrent streams per client IP; extra connections get `429`.
- The per-IP stream cap and the API rate limiter both key on the client IP. Behind a proxy, set `TRUSTED_PROXY_HOPS` to the number of proxies in front of the app (default `0` = use the connection address). The Nth entry from the right of `X-Forwarded-For` is used, so spoofed left-hand entries are ignored. Without it every shopper shares the proxy's IP and budget.
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

## Email alerts (specs/005-email-open-alerts)

Visitors can leave their email on the storefront to be notified when the shop is next open. Sending
is always a deliberate, staff-only action — creating or editing a service window never emails
anyone on its own.

| Route | Purpose |
|-------|---------|
| `POST /api/v1/subscribers` | Store callers (Basic auth with the store API key). Subscribes an email; re-subscribing an already-unsubscribed address reactivates the same row (same `unsubscribe_token`), not a new one. |
| `GET /api/v1/subscribers` / `GET /api/v1/subscribers/count` | Admin. Lists/counts the caller tenant's subscribers. |
| `DELETE /api/v1/subscriber?id=` | Admin. Unsubscribes (not a hard delete — same state as self-service unsubscribe). |
| `GET /api/v1/subscribers/unsubscribe?token=` | Public, no auth at all. Always returns the same generic success response, even for an unknown or malformed token, so the link can never be used to probe which addresses are subscribed. |
| `POST /api/v1/services/notify?id=` | Admin. Staff's explicit "Notify subscribers" action for a specific service window — sends to every currently-subscribed address and records a `notification_sends` audit row. |

**Postmark setup**: emails go out through Postmark's **Broadcast** message stream, not the
transactional one — this is a one-to-many send to an opt-in list, and Postmark separates the two
for deliverability/reputation reasons. In the Postmark dashboard, create a Broadcast stream (its ID
is literally `broadcast`) on the server you're using, then set `POSTMARK_API_KEY` to that server's
token and `EMAIL_INFO` to the verified sender address, both in `.env`. Until that stream exists,
`POST /services/notify` will fail (`502`) for every send attempt.

For real (non-mocked) test coverage without a live account or without actually delivering mail,
use Postmark's own sandbox token, `POSTMARK_API_TEST` — Postmark accepts and processes the request
normally but never delivers it. The notification test suite uses this automatically.

## Multi-tenancy (specs/004-multi-tenant-supabase)

This is a shared-schema, multi-tenant app: one Postgres database (Supabase), every tenant-scoped
table carries a `tenant_id`, and Row-Level Security enforces isolation at the database layer. Each
tenant is its own pizza business, with its own admin login, products, menus and storefront.

**There is no public signup.** Onboarding a new tenant is a staff-only action, done by running a
script against the server's own database connection — not a form anyone can submit.

### Onboarding a new tenant

```
SUPABASE_SERVICE_ROLE_KEY=<service_role secret, Project Settings → API> \
  npm run onboard-tenant -- "Tenant's Business Name" "America/New_York" owner@example.com
```

Make sure `ADMIN_URL` in `.env` is set to wherever `strawberry-admin` is actually reachable
(locally, that's `https://strawberry.local:5173` per the mkcert setup above, not
`http://localhost:5173`) before running this — it's where the invite email's link sends the new
owner to set their password, and it's baked into that email at send time, so an unset/wrong value
can't be fixed after the fact without re-inviting.

This does four things in one go:
1. Creates the tenant's row in `tenants` (name + IANA timezone — displayed in that zone in the
   admin and storefront UIs; everything is stored in UTC).
2. Invites the owner's email via Supabase Auth (`auth.admin.inviteUserByEmail`) — they get an
   email with a link to set their own password and land on `strawberry-admin`'s login page. No
   password is ever chosen or seen by staff.
3. Creates the matching `admin_users` row (`role: 'owner'`), which is what every RLS policy and
   the `/admin/me` authorization check actually read — the Supabase Auth user alone grants no
   access to anything until this row exists.
4. Issues one storefront API key and prints it once (it's bcrypt-hashed before being stored, so
   this is the only time it's recoverable).

**Hand the printed API key to the new tenant's own developer.** `selloutPizza` in this
organization's repos is only the platform owner's own storefront — every other tenant builds and
deploys their *own* separate storefront project, configured with their own `VITE_API_KEY`
pointing at this same server. There's no shared multi-tenant storefront to add them to.

The `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and every Auth check, so it's passed as a one-off
env var for this single command, not stored in `.env` — same reasoning as the DB superuser
password already not living in `.env` for the production project.

Run `npm run test:onboarding` to verify the script's DB-side logic (two tenants, sharing nothing)
without needing a real service-role key or sending a real email — it stubs the Supabase Auth call
and checks the real database writes.
