import DiffMatchPatch from 'diff-match-patch';

export type DiffOp = -1 | 0 | 1;
export type DiffChunk = [DiffOp, string];

export function computeDiff(before: string, after: string): DiffChunk[] {
    const dmp = new DiffMatchPatch();
    const diffs = dmp.diff_main(before, after) as DiffChunk[];
    dmp.diff_cleanupSemantic(diffs);
    return diffs;
}

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

export function renderHtml(diffs: DiffChunk[]): string {
    const parts: string[] = [];
    for (const [op, text] of diffs) {
        const safe = escapeHtml(text);
        if (op === 1) {
            parts.push(`<ins style="background:#d4f4dd;text-decoration:none;border-radius:2px;padding:0 2px">${safe}</ins>`);
        } else if (op === -1) {
            parts.push(`<del style="background:#fadbd8;text-decoration:line-through;border-radius:2px;padding:0 2px">${safe}</del>`);
        } else {
            parts.push(`<span>${safe}</span>`);
        }
    }
    return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${parts.join('')}</div>`;
}

export function renderText(diffs: DiffChunk[]): string {
    const parts: string[] = [];
    for (const [op, text] of diffs) {
        if (op === 1) parts.push(`{+${text}+}`);
        else if (op === -1) parts.push(`[-${text}-]`);
        else parts.push(text);
    }
    return parts.join('');
}

export function diffStats(diffs: DiffChunk[]): { added: number; removed: number } {
    let added = 0;
    let removed = 0;
    for (const [op, text] of diffs) {
        if (op === 1) added += text.length;
        else if (op === -1) removed += text.length;
    }
    return { added, removed };
}
