/**
 * Google Apps Script receiver for the obsidian-note-change-email plugin.
 *
 * Deploys as a Web App that accepts POST requests from the plugin and sends
 * email via the deployer's Gmail account using MailApp.sendEmail().
 *
 * Setup:
 *   1. https://script.google.com → New project, paste this file in.
 *   2. Edit SHARED_SECRET below to a random string of your choosing.
 *   3. Deploy → New deployment → Type "Web app".
 *      - Execute as: Me (your-email@gmail.com)
 *      - Who has access: Anyone   (anonymous; secret in URL query string protects it)
 *   4. Authorize the script when prompted (gives it permission to send mail
 *      from your Gmail and to accept anonymous web requests).
 *   5. Copy the Web app URL.
 *   6. In the plugin's Webhook URL setting, paste:  <web-app-url>?secret=<your-secret>
 *      (e.g. https://script.google.com/macros/s/AKfy.../exec?secret=abcd1234)
 *
 * Quotas (consumer Gmail):  ~100 recipients / day  via MailApp.
 * Quotas (Workspace):       ~1500 recipients / day via MailApp.
 *
 * Apps Script web apps deployed with "Anyone" access do NOT pass through
 * custom request headers, so the plugin's `Extra request headers` setting
 * is not used here — the secret travels in the URL query string instead.
 */

const SHARED_SECRET = 'PASTE_YOUR_SECRET_HERE';

function doPost(e) {
  try {
    if (e.parameter.secret !== SHARED_SECRET) {
      return jsonResponse({ error: 'forbidden' }, 403);
    }

    const data = JSON.parse(e.postData.contents);

    if (!data.to || !data.subject) {
      return jsonResponse({ error: 'missing to/subject' }, 400);
    }

    MailApp.sendEmail({
      to: data.to,
      subject: data.subject,
      htmlBody: data.html || '',
      body: data.text || '',
      name: 'Note Change Email',
    });

    return jsonResponse({ status: 'sent', to: data.to });
  } catch (err) {
    return jsonResponse({ error: String(err && err.stack || err) }, 500);
  }
}

function doGet(e) {
  return jsonResponse({
    status: 'ok',
    hint: 'POST JSON with secret query param. See repo README.',
  });
}

function jsonResponse(payload, status) {
  // Apps Script ContentService doesn't expose status codes for "Anyone" web apps;
  // the body is what the plugin reads. We include status in the JSON for clarity.
  const body = Object.assign({}, payload, status ? { _status: status } : {});
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
