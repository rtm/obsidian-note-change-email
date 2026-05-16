# Note Change Email

Email a smart diff of your edits when you stop editing a note tagged with a recipient.

## What it does

When you edit an Obsidian note whose frontmatter contains a recipient property (default `notify`), this plugin:

1. Snapshots the note's content the first time you open or modify it after the plugin loads.
2. Watches for further edits, restarting a 5-minute timer (configurable) on each one.
3. After 5 minutes of inactivity, computes a *semantic* word/phrase-level diff (not line-based) using Google's [diff-match-patch](https://github.com/google/diff-match-patch) library.
4. POSTs a JSON payload containing the diff (HTML + plain text) to a webhook URL you configure.
5. You wire that webhook up to the email service of your choice (recipes below).

Example frontmatter:

```yaml
---
notify: alice@example.com
---
```

Or, using a contact name resolved via plugin settings:

```yaml
---
notify: Alice
---
```

The frontmatter value can be a single string or a list. Each entry is treated as an email if it looks like one, otherwise looked up in the **Contacts** map in plugin settings.

## Installation

This plugin is not in the community store. Install it manually:

1. Build: `npm install && npm run build` produces `main.js`.
2. Deploy into your vault: `npm run deploy` (reads `~/.obsidian-dev.json` or `deploy.config.json` for `vaultPath`). Or copy `main.js`, `manifest.json`, `styles.css` into `<your-vault>/.obsidian/plugins/obsidian-note-change-email/`.
3. In Obsidian → Settings → Community plugins, enable **Note Change Email**.

## Configuration

Settings → Note Change Email:

| Setting | Default | Notes |
| --- | --- | --- |
| Enabled | on | Master switch. |
| Webhook URL | (empty) | Your receiver. Try [webhook.site](https://webhook.site/) first to inspect the payload. |
| Extra request headers | (none) | One per line, `Key: Value`. Use this for `Authorization` if posting directly to a transactional-email API. |
| Recipient frontmatter property | `notify` | Only notes with this property are watched. |
| Contacts | (none) | One per line, `Name: email@example.com`. |
| Debounce (minutes) | 5 | Set to 1 while testing. |
| Subject template | `Changes to "{{file}}"` | Placeholders: `{{file}}`, `{{vault}}`, `{{recipient}}`. |

### Commands

- **Send change diff now** — flush the current note's pending diff immediately.
- **Discard pending snapshot** — drop the snapshot without sending.
- **Preview diff for active note** — open a modal with the rendered HTML diff.

## Webhook payload

```json
{
  "to": "alice@example.com",
  "toName": "Alice",
  "subject": "Changes to \"Project Plan\"",
  "html": "<div>...<ins>added text</ins>...<del>removed text</del>...</div>",
  "text": "...{+added text+}...[-removed text-]...",
  "file": "Notes/Project Plan.md",
  "vault": "Vault",
  "timestamp": "2026-04-25T18:30:00Z",
  "stats": { "added": 42, "removed": 17 }
}
```

The plugin does one POST per recipient.

## Receiver recipes

Pick whichever fits your stack. The plugin doesn't care, as long as the receiver returns a 2xx.

### A. Google Apps Script (no third-party signup, sends from your own Gmail — recommended if you live in Google)

A copy-pasteable receiver script lives at [`examples/apps-script-receiver.gs`](./examples/apps-script-receiver.gs).

1. Go to [script.google.com](https://script.google.com/), create a new project, paste in `examples/apps-script-receiver.gs`.
2. Edit the `SHARED_SECRET` constant to a random string of your choice.
3. Deploy → **New deployment** → Type "Web app".
   - Execute as: **Me**
   - Who has access: **Anyone** (anonymous; the secret in the URL query string protects it)
4. Authorize the script when prompted — it needs `gmail.send` and `script.external_request` permissions.
5. Copy the deployed Web app URL.
6. In the plugin's **Webhook URL** setting, paste `<web-app-url>?secret=<your-secret>`.

Quotas: ~100 recipients/day (consumer Gmail), ~1500/day (Workspace). No domains or API keys needed.

> Heads up: Apps Script Web Apps deployed with "Anyone" access don't pass custom request headers, so the plugin's **Extra request headers** field is unused here. The shared secret travels in the URL.

### B. Pipedream (no code, free dev tier)

1. Create a free account at [pipedream.com](https://pipedream.com/).
2. New workflow → Add a trigger → **HTTP / Webhook** → "New requests". Copy the generated URL into the plugin's **Webhook URL** setting.
3. Add a step → **Email** → "Send Email With Pipedream" (no SMTP config needed) or **Gmail** → "Send Email" (auth your Gmail).
4. In the Email step's `to` field, reference `{{steps.trigger.event.body.to}}`. Likewise for `subject` (`{{steps.trigger.event.body.subject}}`) and `html` (`{{steps.trigger.event.body.html}}`).
5. Deploy. Test by editing a tagged note in Obsidian and running **Send change diff now**.

### C. Cloudflare Worker → Resend (a little code, more control)

1. Sign up at [resend.com](https://resend.com/) and verify a sending domain. Grab an API key.
2. `npm create cloudflare@latest note-change-email-relay` → Worker.
3. Replace the Worker source with:

   ```js
   export default {
     async fetch(req, env) {
       if (req.method !== 'POST') return new Response('POST only', { status: 405 });
       if (req.headers.get('x-shared-secret') !== env.SHARED_SECRET) {
         return new Response('forbidden', { status: 403 });
       }
       const { to, subject, html } = await req.json();
       const r = await fetch('https://api.resend.com/emails', {
         method: 'POST',
         headers: {
           'Authorization': `Bearer ${env.RESEND_KEY}`,
           'Content-Type': 'application/json',
         },
         body: JSON.stringify({
           from: 'Notes <notes@yourdomain.tld>',
           to, subject, html,
         }),
       });
       return new Response(await r.text(), { status: r.status });
     },
   };
   ```

4. `wrangler secret put RESEND_KEY` and `wrangler secret put SHARED_SECRET`. Deploy with `wrangler deploy`.
5. In Obsidian: set the plugin's **Webhook URL** to the Worker URL, and add an extra header `x-shared-secret: <your secret>`.

Resend's free tier covers 100 emails/day — plenty for personal use.

### D. Zapier (no code, simplest UI)

"Webhooks by Zapier — Catch Hook" trigger → "Gmail — Send Email" action. Map fields the same way as Pipedream. Free plan: 100 tasks/month.

### E. Self-hosted (n8n, Hookdeck, your own Express receiver)

Same idea as Pipedream but on your own infra.

### F. GitHub repository_dispatch + Actions

POST to `https://api.github.com/repos/<owner>/<repo>/dispatches` with a token; an Action handles the email step (e.g. `dawidd6/action-send-mail`). Free for public repos. Latency: ~30s. Hacky but works without third-party automation accounts.

## Notes / limitations

- **Snapshot timing**: the snapshot is taken on `file-open` or first `modify`, whichever comes first. If you start typing before the plugin sees `file-open` for a freshly created note, the very first save might be folded into the snapshot rather than the diff. A more accurate version using editor transactions is on the to-do list.
- **Mobile**: should work — uses Obsidian's `requestUrl` (not `fetch`) for the POST, so no CORS surprises.
- **No queue / retry**: if the webhook fails, the snapshot is preserved so the next edit will re-arm. There's no background retry, so a permanently-broken receiver won't spam your console.
- **Closest existing plugin**: [tommll/obsidian-email-plugin](https://github.com/tommll/obsidian-email-plugin) is the only related plugin I found. It sends a *selection* via Gmail SMTP from inside the client (stores app passwords in the vault, last release April 2024, lightly maintained). Different goal, but worth knowing about.
- **MailChannels**: was the canonical free Worker → email path; [sunset 2024-08-31](https://support.mailchannels.com/hc/en-us/articles/4565898358413). Use Resend / Pipedream / similar.

## Future work

- Pre-edit snapshot via editor transactions (tighter "session begins" boundary).
- Optional per-note debounce override in frontmatter.
- LLM-generated prose summaries ("added 3 sentences about X, removed paragraph on Y").
- Diff history pane inside Obsidian.
- Native SMTP support for desktop (without the Gmail app-password model of `tommll/obsidian-email-plugin`).
- Payload templating, so the plugin can POST directly to vendor APIs without an adapter Worker.

## License

MIT.
