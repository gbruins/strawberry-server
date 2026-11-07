// Provisions (or updates) the "order-ready" Postmark template used by NotificationService.js's
// sendOrderReadyEmail() — the Kitchen Display System's completion notice, fired when a kitchen
// ticket is marked 'completed'. Run once per Postmark server (and again whenever the template
// content below changes) — idempotent, matched by Alias. See createReceiptTemplate.js, which
// this deliberately mirrors.
import postmark from 'postmark';

const TEMPLATE_ALIAS = 'order-ready';

const PREHEADER = 'Your order from {{tenant_name}} is ready — pickup code {{pickup_code}}';

const HTML_BODY = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Order Ready</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${PREHEADER}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="padding:32px 32px 8px 32px;text-align:center;">
<p style="margin:0;font-size:14px;color:#666666;">Your order from</p>
<h1 style="margin:4px 0 0 0;font-size:22px;color:#111111;">{{tenant_name}}</h1>
<p style="margin:8px 0 0 0;font-size:18px;color:#1a7f37;font-weight:bold;">is ready for pickup!</p>
</td></tr>
<tr><td style="padding:24px 32px;text-align:center;">
<p style="margin:0 0 8px 0;font-size:14px;color:#666666;text-transform:uppercase;letter-spacing:1px;">Your pickup code</p>
<div style="display:inline-block;background-color:#0a2540;color:#ffffff;font-size:48px;font-weight:bold;letter-spacing:4px;padding:16px 32px;border-radius:8px;line-height:1;">{{pickup_code}}</div>
<p style="margin:12px 0 0 0;font-size:14px;color:#666666;">Give this number to our staff when you arrive.</p>
</td></tr>
{{#address}}
<tr><td style="padding:8px 32px 32px 32px;text-align:center;border-top:1px solid #eeeeee;">
<p style="margin:16px 0 0 0;font-size:14px;color:#666666;text-transform:uppercase;letter-spacing:1px;">Pick up at</p>
<p style="margin:4px 0 0 0;font-size:16px;color:#111111;">{{line1}}</p>
{{#line2}}<p style="margin:0;font-size:16px;color:#111111;">{{.}}</p>{{/line2}}
<p style="margin:0;font-size:16px;color:#111111;">{{city_state_zip}}</p>
{{#phone}}<p style="margin:8px 0 0 0;font-size:14px;color:#666666;"><a href="tel:{{.}}" style="color:#666666;text-decoration:none;">{{.}}</a></p>{{/phone}}
</td></tr>
{{/address}}
<tr><td style="padding:16px 32px 32px 32px;text-align:center;border-top:1px solid #eeeeee;">
<p style="margin:0;font-size:13px;color:#999999;">Questions about your order? Just reply to this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

const TEXT_BODY = `{{tenant_name}} — Your order is ready!

Your pickup code: {{pickup_code}}
Give this number to our staff when you arrive.
{{#address}}
Pick up at:
{{line1}}
{{#line2}}{{.}}
{{/line2}}{{city_state_zip}}
{{#phone}}{{.}}
{{/phone}}
{{/address}}
Questions about your order? Just reply to this email.`;

const templateFields = {
    Name: 'Order Ready',
    Alias: TEMPLATE_ALIAS,
    Subject: 'Your order from {{tenant_name}} is ready — pickup code {{pickup_code}}',
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
