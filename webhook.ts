import { requestUrl } from 'obsidian';

export interface WebhookPayload {
    to: string;
    toName?: string;
    subject: string;
    html: string;
    text: string;
    file: string;
    vault: string;
    timestamp: string;
    stats?: { added: number; removed: number };
}

export async function postWebhook(
    url: string,
    extraHeaders: Record<string, string>,
    payload: WebhookPayload,
): Promise<void> {
    const response = await requestUrl({
        url,
        method: 'POST',
        contentType: 'application/json',
        headers: {
            'Content-Type': 'application/json',
            ...extraHeaders,
        },
        body: JSON.stringify(payload),
        throw: false,
    });

    if (response.status >= 400) {
        throw new Error(`Webhook returned ${response.status}: ${response.text?.slice(0, 200) ?? ''}`);
    }
}
