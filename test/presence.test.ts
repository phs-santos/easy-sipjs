import { describe, expect, it } from "vitest";
import { parsePresenceBody } from "../src/core/presence.js";

const dialogInfo = (dialogs: string) =>
    `<?xml version="1.0"?><dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" version="1" state="full" entity="sip:1000@example.com">${dialogs}</dialog-info>`;

const status = (body: string, contentType: string) => parsePresenceBody("sip:1000@example.com", body, contentType, undefined).status;

describe("parsePresenceBody — dialog-info (BLF)", () => {
    const type = "application/dialog-info+xml";

    it("reports an idle extension as available when its last dialog is terminated", () => {
        expect(status(dialogInfo(`<dialog id="1"><state>terminated</state></dialog>`), type)).toBe("available");
    });

    it("reports an extension with no dialogs as available", () => {
        expect(status(dialogInfo(""), type)).toBe("available");
    });

    it("reports ringing for an early dialog", () => {
        expect(status(dialogInfo(`<dialog id="1" direction="recipient"><state>early</state></dialog>`), type)).toBe("ringing");
    });

    it("reports busy for a confirmed dialog, even alongside a terminated one", () => {
        const body = dialogInfo(`<dialog id="1"><state>terminated</state></dialog><dialog id="2"><state>confirmed</state></dialog>`);
        expect(status(body, type)).toBe("busy");
    });
});

describe("parsePresenceBody — PIDF", () => {
    const type = "application/pidf+xml";
    const pidf = (basic: string, note = "") =>
        `<presence xmlns="urn:ietf:params:xml:ns:pidf" entity="sip:1000@example.com"><tuple id="t"><status><basic>${basic}</basic></status></tuple>${note}</presence>`;

    it("maps basic open/closed to available/offline", () => {
        expect(status(pidf("open"), type)).toBe("available");
        expect(status(pidf("closed"), type)).toBe("offline");
    });

    it("uses the PBX note to tell busy and ringing apart from a plain open", () => {
        expect(status(pidf("open", "<note>On the phone</note>"), type)).toBe("busy");
        expect(status(pidf("open", "<note>Ringing</note>"), type)).toBe("ringing");
    });

    it("exposes the note and the extension", () => {
        const event = parsePresenceBody("sip:1000@example.com", pidf("open", "<note>Ready</note>"), type, undefined);
        expect(event.note).toBe("Ready");
        expect(event.extension).toBe("1000");
    });

    it("returns unknown for an empty body", () => {
        expect(status("", type)).toBe("unknown");
    });
});
