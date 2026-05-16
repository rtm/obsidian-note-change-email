import { App, PluginSettingTab, Setting } from 'obsidian';
import type NoteChangeEmailPlugin from './main';

export interface NoteChangeEmailSettings {
    enabled: boolean;
    webhookUrl: string;
    extraHeaders: Record<string, string>;
    recipientProperty: string;
    contacts: Record<string, string>;
    debounceMinutes: number;
    subjectTemplate: string;
}

export const DEFAULT_SETTINGS: NoteChangeEmailSettings = {
    enabled: true,
    webhookUrl: '',
    extraHeaders: {},
    recipientProperty: 'notify',
    contacts: {},
    debounceMinutes: 5,
    subjectTemplate: 'Changes to "{{file}}"',
};

function parseKeyValueLines(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (key) result[key] = value;
    }
    return result;
}

function stringifyKeyValueLines(obj: Record<string, string>): string {
    return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join('\n');
}

export class NoteChangeEmailSettingTab extends PluginSettingTab {
    plugin: NoteChangeEmailPlugin;

    constructor(app: App, plugin: NoteChangeEmailPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('note-change-email-settings');

        containerEl.createEl('h2', { text: 'Note Change Email' });
        const intro = containerEl.createEl('p');
        intro.appendText('When a note has the recipient property in its frontmatter (default ');
        intro.createEl('code', { text: 'notify' });
        intro.appendText('), this plugin snapshots its content on the first edit, debounces for the configured number of minutes after the last edit, then POSTs a smart diff to your webhook URL. See the README for receiver setup recipes (Pipedream, Cloudflare Worker + Resend, etc.).');

        new Setting(containerEl)
            .setName('Enabled')
            .setDesc('Master switch. When off, no snapshots are taken and no webhooks fire.')
            .addToggle(t => t
                .setValue(this.plugin.settings.enabled)
                .onChange(async v => {
                    this.plugin.settings.enabled = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Webhook URL')
            .setDesc('Where to POST diff payloads. Use https://webhook.site/ to inspect, then swap in your real receiver.')
            .addText(t => {
                t.inputEl.type = 'password';
                t.setPlaceholder('https://...')
                    .setValue(this.plugin.settings.webhookUrl)
                    .onChange(async v => {
                        this.plugin.settings.webhookUrl = v.trim();
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Extra request headers')
            .setDesc('One per line, "Key: Value". Useful for Authorization tokens when posting directly to a transactional email API.')
            .addTextArea(t => {
                t.inputEl.rows = 4;
                t.setPlaceholder('Authorization: Bearer re_xxx')
                    .setValue(stringifyKeyValueLines(this.plugin.settings.extraHeaders))
                    .onChange(async v => {
                        this.plugin.settings.extraHeaders = parseKeyValueLines(v);
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Recipient frontmatter property')
            .setDesc('The plugin only acts on notes whose frontmatter contains this property.')
            .addText(t => t
                .setPlaceholder('notify')
                .setValue(this.plugin.settings.recipientProperty)
                .onChange(async v => {
                    this.plugin.settings.recipientProperty = v.trim() || 'notify';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Contacts')
            .setDesc('One per line, "Name: email@example.com". When the frontmatter value is not itself an email, it is looked up here.')
            .addTextArea(t => {
                t.inputEl.rows = 6;
                t.setPlaceholder('Alice: alice@example.com\nBob Myers: bob@example.com')
                    .setValue(stringifyKeyValueLines(this.plugin.settings.contacts))
                    .onChange(async v => {
                        this.plugin.settings.contacts = parseKeyValueLines(v);
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Debounce (minutes)')
            .setDesc('Send the diff this many minutes after the last edit. Set to 1 for testing.')
            .addText(t => t
                .setValue(String(this.plugin.settings.debounceMinutes))
                .onChange(async v => {
                    const n = Number(v);
                    if (Number.isFinite(n) && n > 0) {
                        this.plugin.settings.debounceMinutes = n;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Subject template')
            .setDesc('Available placeholders: {{file}}, {{vault}}, {{recipient}}.')
            .addText(t => t
                .setValue(this.plugin.settings.subjectTemplate)
                .onChange(async v => {
                    this.plugin.settings.subjectTemplate = v;
                    await this.plugin.saveSettings();
                }));
    }
}
