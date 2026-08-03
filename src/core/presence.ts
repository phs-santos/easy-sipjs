import { PresenceEvent } from "./types.js";

/**
 * Parses a presence/BLF NOTIFY body (PIDF or dialog-info XML) into the
 * provider-agnostic `PresenceEvent` shape. Shared by every provider so
 * presence status is interpreted identically regardless of the underlying
 * SIP stack.
 */
export function parsePresenceBody(target: string, body: string | undefined, contentType: string | undefined, raw: unknown): PresenceEvent {
    const lower = String(body ?? '').toLowerCase();
    let status: PresenceEvent['status'] = 'unknown';

    if (lower.includes('<basic>open</basic>') || lower.includes('state="early"')) status = 'available';
    if (lower.includes('<basic>closed</basic>') || lower.includes('terminated')) status = 'offline';
    if (lower.includes('confirmed') || lower.includes('busy')) status = 'busy';
    if (lower.includes('proceeding') || lower.includes('ringing')) status = 'ringing';

    return {
        target,
        extension: target.replace(/^sips?:/i, '').split('@')[0],
        status,
        body: body ?? '',
        contentType,
        raw,
    };
}
