# strawberry-server

Node/Hapi.js 21 API backend for a multi-tenant pizza ordering platform. Three repos total:
- `selloutPizza` — customer-facing Vue storefront SPA (authenticates via per-tenant API key, not Supabase)
- `strawberry-admin` — owner/admin Vue SPA (authenticates via Supabase Auth JWT)
- `strawberry-server` (this repo) — the API both of the above talk to; Knex query builder against Supabase-hosted Postgres, with Postgres RLS enforced via a restricted non-superuser DB role

## Data model essentials

- There is no "Order" entity — an order is a `carts` row (`server/db/migrations/20251106122000_carts.js`) that gets "closed" at checkout. Fulfillment-relevant columns: `closed_at` (payment confirmed, set in `CheckoutService.completeCartFromSession()`), `shipped_at` (defined, currently unused for fulfillment), `deleted_at`.
- `pickup_code`/`pickup_code_date` (migration `20251106123300_pickup_codes.js`) is the de facto order number shown to customers and used in emails.
- Order contents live in a separate `cart_items` table (`server/db/migrations/20251106122200_cart_items.js`), related to `carts` — not inline columns on `carts`. See `CheckoutService.js:456-460` for the standard `cart_items → {name, quantity, price}` mapping used when building email payloads.
- Product types are per tenant; products point at one by `products.product_type = product_types.value` (required, unique per tenant). The `pizza` slug is built in (`server/plugins/productTypes/builtInProductTypes.js`, seeded by `ensureBuiltInProductTypes` in onboarding, seeds and `createTestTenant`) and protected from delete and slug changes. Only pizzas count toward a service's inventory, checkout holds and `max_per_order` (`server/plugins/service/ServiceStock.js`); always join types with `joinProductType` there, which also matches `tenant_id`.
- What a customer can order in a service = its published menu's products minus that service's `service_unavailable_products` (per-service "out of stock"). `server/plugins/service/ServiceAvailability.js` is the single source for this; add-to-cart (`CartItemService.assertWithinLimits`) and checkout (`CheckoutService.createCheckout`) both use it.
- `tenants` table (`server/db/migrations/20251106123100_multi_tenant_foundation.js`): `id`, `name`, `timezone`, `status` (`active`/`suspended`), `created_at`.

## Migration filenames — all `YYYYMMDDHHMMSS_description.js`, sort order IS run order

Every migration filename uses the same zero-padded `YYYYMMDDHHMMSS_description.js` timestamp
prefix, chosen so Knex's plain-string sort of the filenames reproduces the real dependency
order. Keep it that way — give every new migration a timestamp prefix later than the latest
existing one.

This repo used to mix that scheme with old short numeric prefixes (`20_carts.js`,
`96_multi_tenant_foundation.js`), on the incorrect assumption that `migrate:latest` was
unaffected because "it only ever runs the actually-pending set." That's true but irrelevant —
Knex still runs the pending set *in sorted-filename order*, and in ASCII a digit (`0`-`9`) sorts
before `_`, so every `"2025…"`/`"2026…"` timestamped file sorted **before** every old short-
numbered one, regardless of which was actually written or run first. This was invisible in every
environment that already had the early tables from way back, since those migrations were simply
skipped as already-applied — it only surfaced the first time every migration was pending at once,
on the first real production deploy, where it broke immediately: a later migration altering
`carts` ran before the migration that creates `carts`, failing with `relation "carts" does not
exist`. All short-numbered files were renamed to fit the timestamp scheme in their true
dependency order to fix this (git history has the mapping).

Still true regardless of naming scheme: `migrate:down`/`migrate:rollback` determine "the most
recent migration" by this same full-list filename order, not by actual run history, so they can
roll back the wrong migration if filenames and apply-order ever diverge again. If a migration
needs undoing, write a new forward migration that reverses it rather than trusting
`migrate:down`/`rollback` to pick the right file.

## Owner self-service writes to a control-plane table

`tenants` is otherwise SELECT-only to `APP_ROLE` (see the control-plane note below), but an owner can update their own tenant's address fields via `GET /tenant` / `PUT /tenant/address` (`server/plugins/tenant/`) — a column-level `GRANT UPDATE (address_line1, ...)` plus a policy scoped to `id = app_current_tenant_id()` (20261102120400_tenant_address_write.js), not a table-level grant. This is the pattern to copy if a future feature needs a narrow, owner-facing write to an otherwise script-only table: grant only the specific columns, never the whole table.

## Plugin architecture

Each feature is a plugin under `server/plugins/<name>/`, typically with `Controller`/`Service`/`Model` files extending `server/plugins/base/BaseController.js` / `BaseModel.js`. Routes are registered per-plugin in that plugin's own `index.js`.

## Multi-tenant RLS

Postgres RLS policies key off `tenant_id` + `app_current_tenant_id()`, a SQL function reading the `app.current_tenant_id` Postgres GUC. That GUC is set per-request-transaction in `server/plugins/serverExtensions/index.js`'s `onPreHandler`, which reads `request.auth.credentials.tenant_id` — **strategy-agnostic**: it doesn't care which auth strategy produced those credentials, so any new auth strategy that resolves a `tenant_id` gets full RLS tenant-isolation for free, with no changes needed to `onPreHandler` itself.

Some tables are "control-plane" and deliberately NOT tenant-isolated (`admin_users`, `tenant_api_keys`, and similarly-shaped lookup tables): they get `ENABLE ROW LEVEL SECURITY` + a SELECT-only `APP_ROLE` policy instead of the `tenant_isolation` policy, because the tenant isn't known yet at the point they're queried (e.g. looking up which tenant an API key or station code belongs to).

## Auth strategies (`server/plugins/serverExtensions/index.js`)

- `adminBearer` — Supabase Auth JWT, verified via JWKS (`AuthService.verifyAdminToken`), resolves `tenant_id`/`role` from `admin_users`. This is `server.auth.default()` — every route is admin-only unless it opts out with `auth: false` or a different strategy.
- `apiKey` — Basic auth for the storefront; bcrypt-compares the presented key against every active `tenant_api_keys` row (`AuthService.apiKeyIsValid`) to resolve `tenant_id`. Fine at the current provisioned scale; not a lookup table pattern.
- Supabase Auth JWTs are verified by JWKS fetched from `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`; platform-staff cross-tenant impersonation goes through an explicit `X-Tenant-Id` header, gated per-route via `options.app.allowPlatformStaffImpersonation`.

## Multi-strategy auth hazard — two `Bearer <token>`-style strategies can't share a route's `strategies: [...]` list

Hapi's `auth: { strategies: [a, b] }` only falls through from `a` to `b` when `a`'s scheme reports "no credentials presented at all" — `@hapi/boom`'s `unauthorized()` only sets the internal `isMissing` flag when called with no message (`Boom.unauthorized(null, 'Bearer')`); calling it with a message (`Boom.unauthorized('Invalid token', 'Bearer')`) does not, and Hapi treats that as a hard stop, never trying the next strategy. `adminBearer` + `apiKey` coexist as a list today only because `apiKey` is Basic auth — a storefront caller never sends an `Authorization: Bearer` header in the first place, so `adminBearer`'s own "header missing/not Bearer" check (which does produce the `isMissing` case) is what actually triggers the fallthrough, not any general multi-strategy mechanism. A second `Bearer`-style strategy (e.g. a kitchen station's opaque token) breaks this: `adminBearer` sees a well-formed `Bearer` header, fails JWT verification with a message, and Hapi stops right there — the second strategy's `authenticate()` never even runs (confirmed by adding a log inside it that never fired). The fix is a single combined scheme that tries both credential types itself (see `adminOrKitchenBearer` in `serverExtensions/index.js`), not a `strategies: [...]` list — do this for any future auth strategy that also uses `Authorization: Bearer`.

## Email

`server/plugins/notifications/NotificationService.js` sends via Postmark. Two stream types: broadcast (`sendOpeningNotification`, inline HTML) vs transactional/outbound (`sendReceiptEmail`, fired synchronously from `CheckoutService.completeCartFromSession()`). Templates are managed in Postmark's dashboard and referenced only by alias string — there's no local templates directory. Provisioning is idempotent (create-or-update-by-alias) via scripts named `scripts/create*Template.js` (e.g. `createReceiptTemplate.js`).

## Deployment

Deployed on Render; the blueprint (`render.yaml`) lives in the `selloutPizza` repo's root even though it defines services for all three apps (`strawberry-server`, `strawberry-admin`, and the storefront itself). Check there first for any cross-app deployment/env question.
