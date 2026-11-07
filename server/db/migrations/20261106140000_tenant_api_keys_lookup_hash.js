// AuthService.apiKeyIsValid currently bcrypt-compares a presented storefront API key against
// EVERY active tenant_api_keys row (bcrypt hashes can't be looked up by equality) — fine at
// the handful-of-tenants scale this was built for, but it's O(active tenants) bcrypt compares
// on every unauthenticated request, and bcrypt is deliberately slow.
//
// These API keys (scripts/makeApiKey.js: `uuidv4().replace(/-/g, '')`) are 128 bits of random
// entropy, not a human-memorable secret — the whole reason bcrypt exists (resisting brute-force
// guessing over a small input space) doesn't apply to them the way it does to a password. A
// fast deterministic hash is the standard approach for this kind of high-entropy token (same
// pattern as e.g. GitHub/Stripe API key lookup), so `lookup_hash` (plain SHA-256 of the raw key,
// computed in AuthService) turns the lookup into a single indexed equality match; `key_hash`
// (bcrypt) stays and is still checked against that one candidate row, so the stored trust model
// doesn't change, only how the matching row is found.
//
// NOT NULL with no backfill: nothing has shipped yet (dev-only so far), so rather than carrying
// permanent fallback-loop complexity in AuthService for rows that can never get a lookup_hash
// (the plaintext behind an existing bcrypt hash was never stored, by design, so it can't be
// computed after the fact regardless), this clears the table and re-provisions straight to the
// new shape. Re-run `npm run make-api-key <tenant-id>` (or re-run onboardTenant) for any
// dev tenant that needs a working key after this migration.
export async function up(knex) {
    await knex('tenant_api_keys').del();

    await knex.schema.alterTable('tenant_api_keys', (t) => {
        t.string('lookup_hash').notNullable();
    });

    await knex.raw('CREATE UNIQUE INDEX tenant_api_keys_lookup_hash_unique ON tenant_api_keys (lookup_hash)');
}

export async function down(knex) {
    await knex.raw('DROP INDEX IF EXISTS tenant_api_keys_lookup_hash_unique');
    await knex.schema.alterTable('tenant_api_keys', (t) => {
        t.dropColumn('lookup_hash');
    });
}
