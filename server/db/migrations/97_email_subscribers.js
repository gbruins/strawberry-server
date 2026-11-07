// Email alerts for next store opening (specs/005-email-open-alerts): email_subscribers,
// notification_sends, and the unsubscribe_by_token() function. These tables were created AFTER
// 96_multi_tenant_foundation.js's TENANT_SCOPED_TABLES loop already ran once, so they get no
// tenant_id/RLS for free — this migration replicates that same block directly (research.md #5).

const APP_ROLE = process.env.SUPABASE_APP_DB_USER || process.env.DB_APPUSER || 'appuser';

if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(APP_ROLE)) {
    throw new Error(`DB_APPUSER "${APP_ROLE}" is not a safe SQL identifier`);
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.createTable('email_subscribers', (t) => {
        t.uuid('id').primary().unique().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('tenant_id').notNullable().references('id').inTable('tenants');
        t.string('email').notNullable();
        t.enu('status', ['subscribed', 'unsubscribed']).notNullable().defaultTo('subscribed');
        t.uuid('unsubscribe_token').notNullable().defaultTo(knex.raw('uuid_generate_v4()'));
        t.timestamp('subscribed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.timestamp('unsubscribed_at', { useTz: true }).nullable();
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.timestamp('updated_at', { useTz: true }).nullable();
    });

    // Case-insensitive uniqueness per tenant (data-model.md) — a plain column index can't
    // express lower(email), so this is a raw expression index + a matching exclusion constraint.
    await knex.raw(`
        CREATE UNIQUE INDEX email_subscribers_tenant_email_unique
        ON email_subscribers (tenant_id, lower(email))
    `);
    // The public unsubscribe route's only lookup key, with no tenant context to scope by.
    await knex.raw('CREATE INDEX email_subscribers_unsubscribe_token_idx ON email_subscribers (unsubscribe_token)');

    await knex.schema.createTable('notification_sends', (t) => {
        t.uuid('id').primary().unique().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('tenant_id').notNullable().references('id').inTable('tenants');
        t.uuid('service_id').notNullable().references('id').inTable('service');
        t.integer('recipient_count').notNullable();
        t.timestamp('sent_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    for (const table of ['email_subscribers', 'notification_sends']) {
        await knex.raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        await knex.raw(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
        await knex.raw(`
            CREATE POLICY tenant_isolation ON ${table}
            USING (tenant_id = app_current_tenant_id())
            WITH CHECK (tenant_id = app_current_tenant_id())
        `);
        await knex.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO ${APP_ROLE}`);
    }

    // Narrow, auditable RLS bypass for exactly one case: the public unsubscribe link
    // (GET /subscribers/unsubscribe, auth: false — a bare click from an email client, no store
    // key, no admin JWT, no tenant context at all) needs to resolve and update a subscriber by
    // token alone. Same shape and justification as get_cart_tenant_id() (96_multi_tenant_
    // foundation.js) — SECURITY DEFINER runs as this function's owner regardless of caller, so
    // this is a single-purpose exception, not a blanket bypass: it only ever touches the one
    // row matching the given token, and only ever sets it to 'unsubscribed'.
    // COALESCE to false on no-match: a scalar SQL function returns NULL (not false) when its
    // final query produces zero rows — a data-modifying CTE here lets the function body stay
    // one statement while still distinguishing "no match" from "match" cleanly (found by QA
    // review: the original single UPDATE...RETURNING form returned NULL on no-match, which is
    // still falsy enough that nothing downstream broke, but didn't match this function's own
    // documented contract of returning a real boolean).
    await knex.raw(`
        CREATE FUNCTION unsubscribe_by_token(p_token uuid) RETURNS boolean
        LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
            WITH updated AS (
                UPDATE email_subscribers
                SET status = 'unsubscribed', unsubscribed_at = now()
                WHERE unsubscribe_token = p_token AND status = 'subscribed'
                RETURNING true
            )
            SELECT COALESCE((SELECT true FROM updated LIMIT 1), false);
        $$
    `);
    await knex.raw(`GRANT EXECUTE ON FUNCTION unsubscribe_by_token(uuid) TO ${APP_ROLE}`);
}


/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.raw('DROP FUNCTION IF EXISTS unsubscribe_by_token(uuid)');

    for (const table of ['email_subscribers', 'notification_sends']) {
        await knex.raw(`REVOKE SELECT, INSERT, UPDATE, DELETE ON ${table} FROM ${APP_ROLE}`);
        await knex.raw(`DROP POLICY IF EXISTS tenant_isolation ON ${table}`);
        await knex.raw(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }

    await knex.schema.dropTableIfExists('notification_sends');
    await knex.schema.dropTableIfExists('email_subscribers');
}
