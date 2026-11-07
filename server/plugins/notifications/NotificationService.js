import postmark from 'postmark';
import { formatInTimeZone } from 'date-fns-tz';

// Not cached as a module-level singleton: a fresh client is cheap to construct (no connection
// pooling to lose), and this way a changed POSTMARK_API_KEY always takes effect immediately —
// relevant for tests, which use Postmark's own "POSTMARK_API_TEST" sandbox token (accepted by
// Postmark's real API, processed normally, but never actually delivers mail) to exercise this
// real code path without needing the live account from T002 set up yet.
function getClient() {
    if (!process.env.POSTMARK_API_KEY) {
        throw new Error('POSTMARK_API_KEY is not set');
    }
    // A notify call holds the request's own Postgres transaction open for as long as this call
    // takes (research.md #2 — awaited, not fire-and-forget) — the postmark client's own default
    // timeout is 60s (found by QA review), which could otherwise tie up one of this app's 10
    // pooled connections for a full minute per slow/hanging call during a real Postmark outage.
    return new postmark.ServerClient(process.env.POSTMARK_API_KEY, { timeout: 10 });
}

function formatWindow(service, timezone) {
    const fmt = 'EEEE, MMMM d \'at\' h:mm a zzz';
    const start = formatInTimeZone(new Date(service.start_at), timezone, fmt);

    if (!service.end_at) {
        return start;
    }

    const end = formatInTimeZone(new Date(service.end_at), timezone, 'h:mm a zzz');
    return `${start} – ${end}`;
}

/**
 * Sends one "we're open" notification to every given recipient via Postmark's Broadcast
 * message stream (research.md #1) — never the transactional stream. Returns per-recipient
 * success/failure (Postmark's Batch API reports each message individually) so a caller can
 * log partial failures without treating the whole send as failed.
 *
 * @param {{ service: object, tenant: { name: string, timezone: string }, recipients: string[] }} args
 */
export async function sendOpeningNotification({ service, tenant, recipients }) {
    if (!recipients.length) {
        return [];
    }

    const windowText = formatWindow(service, tenant.timezone);
    const subject = `${tenant.name} is open ${windowText}`;
    const textBody = `${tenant.name} is open: ${windowText}${service.notes ? `\n\n${service.notes}` : ''}`;
    const htmlBody = `<p>${tenant.name} is open:</p><p><strong>${windowText}</strong></p>${service.notes ? `<p>${service.notes}</p>` : ''}`;

    const messages = recipients.map((email) => ({
        From: process.env.EMAIL_INFO,
        To: email,
        Subject: subject,
        TextBody: textBody,
        HtmlBody: htmlBody,
        MessageStream: 'broadcast'
    }));

    const results = await getClient().sendEmailBatch(messages);

    // Correlate by index against the original `recipients`, not `result.To` — found by QA
    // review: Postmark's batch API omits `To` entirely on a failed entry (only a successful
    // one includes it), so logging result.email for a failure always logged `undefined`,
    // losing the one piece of information partial-failure logging exists to provide. The
    // batch API preserves request order, so index correlation is reliable.
    return results.map((result, i) => ({
        email: recipients[i],
        success: result.ErrorCode === 0,
        message: result.Message
    }));
}

function formatCurrency(cents, currency = 'usd') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() })
        .format((cents || 0) / 100);
}

/**
 * Sends the post-purchase receipt (pickup code + itemized order) on Postmark's transactional
 * stream, via a dashboard-managed template ("order-receipt") rather than inline HTML like
 * sendOpeningNotification above — the itemized line-item loop reads far more cleanly as
 * Handlebars' {{#each items}} than as string concatenation, and a template stays editable
 * without a deploy.
 *
 * Deliberately uses EMAIL_ORDERS, not EMAIL_INFO: Postmark's own guidance (and its dashboard's
 * broadcast-stream setup page) is to isolate a transactional sender's reputation from the
 * broadcast stream's — broadcast mail has inherently higher bounce/complaint rates, which would
 * otherwise drag down deliverability of a receipt the customer is actively expecting.
 *
 * Open/click tracking is disabled, matching Postmark's best-practice guidance for sensitive,
 * already-expected transactional mail (receipts, password resets).
 *
 * @param {{ tenantName: string, billingEmail: string, pickupCode: number, currency: string,
 *   items: { name: string, quantity: number, price: number }[], subtotal: number, tax: number,
 *   total: number }} args
 */
export async function sendReceiptEmail({ tenantName, billingEmail, pickupCode, currency, items, subtotal, tax, total }) {
    if (!process.env.EMAIL_ORDERS) {
        throw new Error('EMAIL_ORDERS is not set');
    }

    await getClient().sendEmailWithTemplate({
        From: process.env.EMAIL_ORDERS,
        To: billingEmail,
        TemplateAlias: 'order-receipt',
        TemplateModel: {
            tenant_name: tenantName,
            pickup_code: String(pickupCode),
            items: (items || []).map((item) => ({
                name: item.name,
                quantity: item.quantity,
                price: formatCurrency(item.price, currency)
            })),
            subtotal: formatCurrency(subtotal, currency),
            tax: formatCurrency(tax, currency),
            total: formatCurrency(total, currency)
        },
        MessageStream: 'outbound',
        TrackOpens: false,
        TrackLinks: 'None'
    });
}

/**
 * Sends the Kitchen Display System's completion notice — order number (pickup_code) plus where
 * to pick it up — when a kitchen ticket is marked 'completed' (CartController.
 * updateKitchenStatusHandler). Same transactional-stream/no-tracking choices as
 * sendReceiptEmail above, and a separate template ("order-ready") rather than reusing
 * "order-receipt": this fires at a different point in the order lifecycle (ticket completion,
 * not checkout) and needs the address fields the receipt template never had.
 *
 * The address block is conditional (`has_address`) rather than required: tenants had no
 * address on file before this feature (20261102120100_tenant_address.js) and may not have
 * filled it in yet — the email must still send, just without pretending to know where to
 * pick up, rather than failing the send entirely.
 *
 * @param {{ tenantName: string, billingEmail: string, pickupCode: number,
 *   tenantAddress: { address_line1?: string, address_line2?: string, address_city?: string,
 *     address_state?: string, address_postal_code?: string, address_phone?: string } }} args
 */
export async function sendOrderReadyEmail({ tenantName, billingEmail, pickupCode, tenantAddress = {} }) {
    if (!process.env.EMAIL_ORDERS) {
        throw new Error('EMAIL_ORDERS is not set');
    }

    const cityStateZip = [
        [tenantAddress.address_city, tenantAddress.address_state].filter(Boolean).join(', '),
        tenantAddress.address_postal_code
    ].filter(Boolean).join(' ');

    const hasAddress = !!(tenantAddress.address_line1 || cityStateZip);

    // Postmark templates render as true Mustache, not Handlebars: a boolean-truthy {{#section}}
    // does NOT fall back to the parent scope for inner variable lookups, so the address fields
    // must live on a nested object (`address`) rather than flat sibling keys — see
    // scripts/createOrderReadyTemplate.js for the matching template structure.
    await getClient().sendEmailWithTemplate({
        From: process.env.EMAIL_ORDERS,
        To: billingEmail,
        TemplateAlias: 'order-ready',
        TemplateModel: {
            tenant_name: tenantName,
            pickup_code: String(pickupCode),
            address: hasAddress ? {
                line1: tenantAddress.address_line1 || '',
                line2: tenantAddress.address_line2 || '',
                city_state_zip: cityStateZip,
                phone: tenantAddress.address_phone || ''
            } : false
        },
        MessageStream: 'outbound',
        TrackOpens: false,
        TrackLinks: 'None'
    });
}
