export function redactSipLog(content: string): string {
    return content
        .replace(/(Authorization|Proxy-Authorization):\s?.+/gi, "$1: [REDACTED]")
        .replace(/(ha1|response|nonce|cnonce|password|secret|token)=([^,;\s]+)/gi, "$1=[REDACTED]")
        .replace(/(sip:)([^@\s;>]+)/gi, "$1[USER]");
}
