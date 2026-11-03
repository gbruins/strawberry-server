// Provisions (or updates) the "order-receipt" Postmark template used by
// NotificationService.js's sendReceiptEmail(). Run once per Postmark server (and again
// whenever the template content below changes) — idempotent, matched by Alias.
//
// dotenv is loaded via `--require dotenv/config` (see package.json's create-receipt-template
// script), not here — same reasoning as scripts/makeApiKey.js's own header comment.
import postmark from 'postmark';

const TEMPLATE_ALIAS = 'order-receipt';

const PREHEADER = 'Your pickup code is {{pickup_code}} — thanks for ordering from {{tenant_name}}!';

const HTML_BODY = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Order Receipt</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${PREHEADER}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="padding:32px 32px 8px 32px;text-align:center;">
<p style="margin:0;font-size:14px;color:#666666;">Thanks for your order from</p>
<h1 style="margin:4px 0 0 0;font-size:22px;color:#111111;">{{tenant_name}}</h1>
</td></tr>
<tr><td style="padding:24px 32px;text-align:center;">
<p style="margin:0 0 8px 0;font-size:14px;color:#666666;text-transform:uppercase;letter-spacing:1px;">Your pickup code</p>
<div style="display:inline-block;background-color:#0a2540;color:#ffffff;font-size:48px;font-weight:bold;letter-spacing:4px;padding:16px 32px;border-radius:8px;line-height:1;">{{pickup_code}}</div>
<p style="margin:12px 0 0 0;font-size:14px;color:#666666;">Give this number to our staff when you arrive.</p>
</td></tr>
<tr><td style="padding:8px 32px 24px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eeeeee;border-bottom:1px solid #eeeeee;">
{{#each items}}
<tr>
<td style="padding:12px 0;font-size:15px;color:#333333;border-bottom:1px solid #f4f4f4;">{{this.quantity}} &times; {{this.name}}</td>
<td style="padding:12px 0;font-size:15px;color:#333333;text-align:right;border-bottom:1px solid #f4f4f4;">{{this.price}}</td>
</tr>
{{/each}}
</table>
</td></tr>
<tr><td style="padding:0 32px 32px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:4px 0;font-size:14px;color:#666666;">Subtotal</td><td style="padding:4px 0;font-size:14px;color:#666666;text-align:right;">{{subtotal}}</td></tr>
<tr><td style="padding:4px 0;font-size:14px;color:#666666;">Tax</td><td style="padding:4px 0;font-size:14px;color:#666666;text-align:right;">{{tax}}</td></tr>
<tr><td style="padding:12px 0 0 0;font-size:16px;font-weight:bold;color:#111111;border-top:1px solid #eeeeee;">Total</td><td style="padding:12px 0 0 0;font-size:16px;font-weight:bold;color:#111111;text-align:right;border-top:1px solid #eeeeee;">{{total}}</td></tr>
</table>
</td></tr>
<tr><td style="padding:16px 32px 32px 32px;text-align:center;border-top:1px solid #eeeeee;">
<p style="margin:0;font-size:13px;color:#999999;">Questions about your order? Just reply to this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

const TEXT_BODY = `{{tenant_name}} — Order Receipt

Your pickup code: {{pickup_code}}
Give this number to our staff when you arrive.

Order:
{{#each items}}
- {{this.quantity}} x {{this.name}} — {{this.price}}
{{/each}}

Subtotal: {{subtotal}}
Tax: {{tax}}
Total: {{total}}

Questions about your order? Just reply to this email.`;

const templateFields = {
    Name: 'Order Receipt',
    Alias: TEMPLATE_ALIAS,
    Subject: 'Your order from {{tenant_name}} — pickup code {{pickup_code}}',
    HtmlBody: HTML_BODY,
    TextBody: TEXT_BODY,
    TemplateType: 'Standard'
};

async function main() {
    if (!process.env.POSTMARK_API_KEY) {
        console.error('POSTMARK_API_KEY is not set');
        process.exit(1);
    }

    const client = new postmark.ServerClient(process.env.POSTMARK_API_KEY);

    const exists = await client.getTemplate(TEMPLATE_ALIAS).catch((err) => {
        if (err.code === 1101) { // Postmark's "template does not exist" error code
            return null;
        }

        throw err;
    });

    if (exists) {
        await client.editTemplate(TEMPLATE_ALIAS, templateFields);
        console.log(`Updated existing "${TEMPLATE_ALIAS}" template (TemplateId ${exists.TemplateId}).`);
    }
    else {
        const created = await client.createTemplate(templateFields);
        console.log(`Created "${TEMPLATE_ALIAS}" template (TemplateId ${created.TemplateId}).`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
