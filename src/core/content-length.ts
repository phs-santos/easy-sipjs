/**
 * Some proxies rewrite SIP bodies without fixing Content-Length (seen on Kamailio:
 * an SDP direction rewrite that also ate a line's "\r"). JsSIP drops a response whose
 * body is shorter than Content-Length, and sip.js can misparse it, so incoming messages
 * get the header recomputed from the body actually received.
 */
const encoder = new TextEncoder();

export function withActualContentLength(raw: string): string {
    const sep = raw.indexOf("\r\n\r\n");
    if (sep === -1) return raw;
    const length = encoder.encode(raw.slice(sep + 4)).length;
    return raw.replace(
        /Content-Length:\s*\d+\r\n/i,
        `Content-Length: ${length}\r\n`
    );
}
