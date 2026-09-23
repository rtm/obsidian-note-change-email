import { Plugin, TFile, Notice, MarkdownView, Modal, App } from 'obsidian';
import {
    NoteChangeEmailSettings,
    NoteChangeEmailSettingTab,
    DEFAULT_SETTINGS,
} from './settings';
import { computeDiff, renderHtml, renderText, diffStats } from './diff';
import { postWebhook, WebhookPayload } from './webhook';

interface Snapshot {
    content: string;
    startedAt: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default class NoteChangeEmailPlugin extends Plugin {
    settings!: NoteChangeEmailSettings;
    private snapshots = new Map<string, Snapshot>();
    private timers = new Map<string, number>();
    // Content as of file-open, for notes without a recipient yet. If a recipient
    // is added during the session, this becomes the snapshot, so the diff covers
    // everything written since the note was opened.
    private baselines = new Map<string, string>();

    async onload() {
        console.log('Loading Note Change Email plugin');
        await this.loadSettings();

        this.addSettingTab(new NoteChangeEmailSettingTab(this.app, this));

        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.onOpen(file);
                }
            }),
        );

        this.registerEvent(
            this.app.metadataCache.on('changed', (file) => {
                if (file.extension === 'md') this.onMetadataChanged(file);
            }),
        );

        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.onModify(file);
                }
            }),
        );

        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                if (this.baselines.has(oldPath)) {
                    this.baselines.set(file.path, this.baselines.get(oldPath)!);
                    this.baselines.delete(oldPath);
                }
                if (this.snapshots.has(oldPath)) {
                    const snap = this.snapshots.get(oldPath)!;
                    this.snapshots.delete(oldPath);
                    this.snapshots.set(file.path, snap);
                }
                if (this.timers.has(oldPath)) {
                    const t = this.timers.get(oldPath)!;
                    this.timers.delete(oldPath);
                    this.timers.set(file.path, t);
                }
            }),
        );

        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                this.baselines.delete(file.path);
                this.discardSnapshot(file.path);
            }),
        );

        this.app.workspace.onLayoutReady(() => {
            const active = this.app.workspace.getActiveFile();
            if (active && active.extension === 'md') this.onOpen(active);
        });

        this.addCommand({
            id: 'send-now',
            name: 'Send change diff now',
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== 'md') return false;
                if (!this.snapshots.has(file.path)) return false;
                if (!checking) this.flush(file, true).catch(e => this.fail(e));
                return true;
            },
        });

        this.addCommand({
            id: 'discard-snapshot',
            name: 'Discard pending snapshot',
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file) return false;
                if (!this.snapshots.has(file.path)) return false;
                if (!checking) {
                    this.discardSnapshot(file.path);
                    new Notice('Discarded pending snapshot.');
                }
                return true;
            },
        });

        this.addCommand({
            id: 'preview-diff',
            name: 'Preview diff for active note',
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== 'md') return false;
                if (!this.snapshots.has(file.path)) return false;
                if (!checking) this.previewDiff(file).catch(e => this.fail(e));
                return true;
            },
        });
    }

    onunload() {
        console.log('Unloading Note Change Email plugin');
        for (const t of this.timers.values()) window.clearTimeout(t);
        this.timers.clear();
        this.snapshots.clear();
        this.baselines.clear();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private getRecipientField(file: TFile): unknown | undefined {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache?.frontmatter) return undefined;
        return cache.frontmatter[this.settings.recipientProperty];
    }

    private async onOpen(file: TFile) {
        if (!this.settings.enabled) return;
        if (this.snapshots.has(file.path)) return;
        if (this.getRecipientField(file) != null) {
            await this.maybeSnapshot(file);
            return;
        }
        if (this.baselines.has(file.path)) return;
        try {
            this.baselines.set(file.path, await this.app.vault.cachedRead(file));
            if (this.baselines.size > 50) {
                this.baselines.delete(this.baselines.keys().next().value!);
            }
        } catch (e) {
            console.warn('Note Change Email: failed to read baseline', file.path, e);
        }
    }

    // Catches a recipient added mid-session: the metadata cache updates after
    // the modify event, so onModify alone would miss the first edit.
    private async onMetadataChanged(file: TFile) {
        if (!this.settings.enabled) return;
        if (this.snapshots.has(file.path)) return;
        if (!this.baselines.has(file.path)) return;
        if (this.getRecipientField(file) == null) return;
        await this.maybeSnapshot(file);
        if (this.snapshots.has(file.path)) this.armTimer(file.path);
    }

    private async maybeSnapshot(file: TFile) {
        if (!this.settings.enabled) return;
        if (this.snapshots.has(file.path)) return;
        if (this.getRecipientField(file) == null) return;
        const baseline = this.baselines.get(file.path);
        if (baseline !== undefined) {
            this.baselines.delete(file.path);
            this.snapshots.set(file.path, { content: baseline, startedAt: Date.now() });
            return;
        }
        try {
            const content = await this.app.vault.cachedRead(file);
            this.snapshots.set(file.path, { content, startedAt: Date.now() });
        } catch (e) {
            console.warn('Note Change Email: failed to snapshot', file.path, e);
        }
    }

    private async onModify(file: TFile) {
        if (!this.settings.enabled) return;
        if (this.getRecipientField(file) == null) return;
        await this.maybeSnapshot(file);
        if (!this.snapshots.has(file.path)) return;
        this.armTimer(file.path);
    }

    private armTimer(path: string) {
        const existing = this.timers.get(path);
        if (existing !== undefined) window.clearTimeout(existing);
        const ms = Math.max(1, this.settings.debounceMinutes) * 60_000;
        const handle = window.setTimeout(() => {
            this.timers.delete(path);
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                this.flush(file).catch(e => this.fail(e));
            }
        }, ms);
        this.timers.set(path, handle);
    }

    private discardSnapshot(path: string) {
        this.snapshots.delete(path);
        const t = this.timers.get(path);
        if (t !== undefined) {
            window.clearTimeout(t);
            this.timers.delete(path);
        }
    }

    private resolveRecipients(field: unknown): { email: string; name?: string }[] {
        const values: string[] = [];
        if (typeof field === 'string') values.push(field);
        else if (Array.isArray(field)) {
            for (const v of field) if (typeof v === 'string') values.push(v);
        } else {
            return [];
        }
        const out: { email: string; name?: string }[] = [];
        for (const raw of values) {
            const v = raw.trim();
            if (!v) continue;
            if (EMAIL_RE.test(v)) {
                out.push({ email: v });
                continue;
            }
            const looked = this.settings.contacts[v];
            if (looked && EMAIL_RE.test(looked)) {
                out.push({ email: looked, name: v });
            } else {
                console.warn(`Note Change Email: cannot resolve recipient "${v}"`);
            }
        }
        return out;
    }

    private fillTemplate(tpl: string, vars: Record<string, string>): string {
        return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
    }

    private async flush(file: TFile, manual = false) {
        const snap = this.snapshots.get(file.path);
        if (!snap) {
            new Notice('No pending changes to send.');
            return;
        }
        const field = this.getRecipientField(file);
        const recipients = this.resolveRecipients(field);
        if (recipients.length === 0) {
            new Notice(`Note Change Email: cannot resolve "${this.settings.recipientProperty}" recipient.`);
            return;
        }
        if (!this.settings.webhookUrl) {
            new Notice('Note Change Email: webhook URL not configured.');
            return;
        }

        const current = await this.app.vault.read(file);
        const diffs = computeDiff(snap.content, current);
        const stats = diffStats(diffs);
        if (stats.added === 0 && stats.removed === 0) {
            this.discardSnapshot(file.path);
            if (manual) new Notice('Note Change Email: no changes since the note was opened; nothing sent.');
            return;
        }

        const html = renderHtml(diffs);
        const text = renderText(diffs);
        const baseName = file.basename;
        const vaultName = this.app.vault.getName();

        const t = this.timers.get(file.path);
        if (t !== undefined) {
            window.clearTimeout(t);
            this.timers.delete(file.path);
        }

        let allOk = true;
        for (const r of recipients) {
            const subject = this.fillTemplate(this.settings.subjectTemplate, {
                file: baseName,
                vault: vaultName,
                recipient: r.name ?? r.email,
            });
            const payload: WebhookPayload = {
                to: r.email,
                toName: r.name,
                subject,
                html,
                text,
                file: file.path,
                vault: vaultName,
                timestamp: new Date().toISOString(),
                stats,
            };
            try {
                await postWebhook(this.settings.webhookUrl, this.settings.extraHeaders, payload);
            } catch (e) {
                allOk = false;
                this.fail(e);
            }
        }

        if (allOk) {
            this.snapshots.delete(file.path);
            new Notice(`Sent change diff for "${baseName}" (+${stats.added}/-${stats.removed} chars).`);
        } else {
            new Notice('Note Change Email: webhook failed; snapshot kept for retry.');
        }
    }

    private async previewDiff(file: TFile) {
        const snap = this.snapshots.get(file.path);
        if (!snap) {
            new Notice('No snapshot for this file.');
            return;
        }
        const current = await this.app.vault.read(file);
        const diffs = computeDiff(snap.content, current);
        new DiffPreviewModal(this.app, file.basename, renderHtml(diffs)).open();
    }

    private fail(e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Note Change Email:', e);
        new Notice(`Note Change Email: ${msg}`);
    }
}

class DiffPreviewModal extends Modal {
    constructor(app: App, private title: string, private html: string) {
        super(app);
    }
    onOpen() {
        this.titleEl.setText(`Diff: ${this.title}`);
        const container = this.contentEl.createDiv({ cls: 'note-change-email-preview' });
        container.innerHTML = this.html;
    }
    onClose() {
        this.contentEl.empty();
    }
}
