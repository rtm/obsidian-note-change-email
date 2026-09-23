import DiffMatchPatch from 'diff-match-patch';

export type DiffOp = -1 | 0 | 1;
export type DiffChunk = [DiffOp, string];

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/;

// Frontmatter is metadata, not note text: edits there (including adding the
// recipient property itself) should never appear in, or trigger, an email.
export function stripFrontmatter(s: string): string {
    return s.replace(FRONTMATTER_RE, '').replace(/^\s*\n/, '');
}

export function computeDiff(before: string, after: string): DiffChunk[] {
    const dmp = new DiffMatchPatch();
    const diffs = dmp.diff_main(stripFrontmatter(before), stripFrontmatter(after)) as DiffChunk[];
    dmp.diff_cleanupSemantic(diffs);
    return diffs;
}

// Characters of unchanged text kept on each side of a change.
const CONTEXT = 150;
const GAP = '…';

function clipStart(text: string, n: number): string {
    if (text.length <= n) return text;
    const cut = text.slice(0, n);
    const sp = cut.lastIndexOf(' ');
    return sp > n / 2 ? cut.slice(0, sp) : cut;
}

function clipEnd(text: string, n: number): string {
    if (text.length <= n) return text;
    const cut = text.slice(text.length - n);
    const sp = cut.indexOf(' ');
    return sp >= 0 && sp < n / 2 ? cut.slice(sp + 1) : cut;
}

type Piece = { op: DiffOp; text: string } | { gap: true };

// Keep every change, but trim long runs of unchanged text to a little context
// on each side, with an ellipsis where text was left out.
function condense(diffs: DiffChunk[]): Piece[] {
    const out: Piece[] = [];
    diffs.forEach(([op, text], i) => {
        if (op !== 0) {
            out.push({ op, text });
            return;
        }
        const first = i === 0;
        const last = i === diffs.length - 1;
        if (first && last) return;
        if (first) {
            const tail = clipEnd(text, CONTEXT);
            if (tail.length < text.length) out.push({ gap: true });
            out.push({ op: 0, text: tail });
        } else if (last) {
            const head = clipStart(text, CONTEXT);
            out.push({ op: 0, text: head });
            if (head.length < text.length) out.push({ gap: true });
        } else if (text.length > CONTEXT * 2 + 40) {
            out.push({ op: 0, text: clipStart(text, CONTEXT) });
            out.push({ gap: true });
            out.push({ op: 0, text: clipEnd(text, CONTEXT) });
        } else {
            out.push({ op: 0, text });
        }
    });
    return out;
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
    for (const piece of condense(diffs)) {
        if ('gap' in piece) {
            parts.push(`<div style="color:#999;margin:6px 0">${GAP}</div>`);
            continue;
        }
        const { op, text } = piece;
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
    for (const piece of condense(diffs)) {
        if ('gap' in piece) {
            parts.push(`\n${GAP}\n`);
            continue;
        }
        const { op, text } = piece;
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
