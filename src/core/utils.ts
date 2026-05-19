/**
 * Utility functions for easy-sipjs
 */

/**
 * Ensures the SIP URI has the 'sip:' scheme prefix.
 * If already present, returns the original URI.
 */
export function ensureSipPrefix(uri: string): string {
    if (!uri) return uri;
    return uri.startsWith("sip:") ? uri : `sip:${uri}`;
}

/**
 * Removes the 'sip:' scheme prefix from the URI.
 * If not present, returns the original URI.
 */
export function stripSipPrefix(uri: string): string {
    if (!uri) return uri;
    return uri.startsWith("sip:") ? uri.substring(4) : uri;
}
