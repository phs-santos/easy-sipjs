import { PresenceEvent } from "./types.js";

/**
 * Parses a presence/BLF NOTIFY body (PIDF or dialog-info XML) into the
 * provider-agnostic `PresenceEvent` shape. Shared by every provider so
 * presence status is interpreted identically regardless of the underlying
 * SIP stack.
 */
export function parsePresenceBody(target: string, body: string | undefined, contentType: string | undefined, raw: unknown): PresenceEvent {
    const text = String(body ?? '');
    const lower = text.toLowerCase();
    const isDialogInfo = (contentType ?? '').toLowerCase().includes('dialog-info') || lower.includes('<dialog-info');

    return {
        target,
        extension: target.replace(/^sips?:/i, '').split('@')[0],
        status: isDialogInfo ? parseDialogInfo(lower) : parsePidf(lower),
        note: text.match(/<(?:\w+:)?note[^>]*>([^<]*)</i)?.[1]?.trim() || undefined,
        body: text,
        contentType,
        raw,
    };
}

/**
 * RFC 4235: each `<dialog>` carries a `<state>`. A dialog-info with no live
 * dialog (none listed, or all `terminated`) means the extension is idle — it
 * says nothing about the device being offline.
 */
function parseDialogInfo(lower: string): PresenceEvent['status'] {
    if (!lower.trim()) return 'unknown';
    const states = [...lower.matchAll(/<(?:\w+:)?state[^>]*>\s*([a-z]+)\s*</g)].map(match => match[1]);
    if (states.includes('confirmed')) return 'busy';
    if (states.some(state => state === 'early' || state === 'proceeding' || state === 'trying')) return 'ringing';
    return 'available';
}

/** RFC 3863 `<basic>` plus the activity/notes PBXs add on top (RPID, Asterisk notes). */
function parsePidf(lower: string): PresenceEvent['status'] {
    if (/\bringing\b/.test(lower)) return 'ringing';
    if (/on[- ]the[- ]phone|\bbusy\b|on hold|in ?use/.test(lower)) return 'busy';
    if (lower.includes('<basic>closed</basic>')) return 'offline';
    if (lower.includes('<basic>open</basic>')) return 'available';
    return 'unknown';
}
