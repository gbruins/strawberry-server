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
