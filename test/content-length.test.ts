// Caso real (dSIPRouter/Kamailio, 20/10): a regra que reescreve a direção do SDP no
// 200 OK do hold comeu o "\r" da linha e deixou Content-Length 1 byte maior que o corpo.
// O JsSIP descartava a resposta e nunca mandava o ACK.
import { describe, expect, it } from "vitest";
import { withActualContentLength } from "../src/core/content-length.js";

const sdpLines = ["v=0", "o=- 1048943277 5 IN IP4 35.247.250.201", "s=Asterisk", "c=IN IP4 35.247.250.201", "t=0 0",
    "m=audio 19994 RTP/SAVPF 0 8 126", "a=sendonly", "a=rtcp-mux"];

function response(body: string, contentLength: number) {
    return `SIP/2.0 200 OK\r\nCSeq: 3549 INVITE\r\nContent-Type: application/sdp\r\nContent-Length: ${contentLength}\r\n\r\n${body}`;
}

describe("withActualContentLength", () => {
    it("corrige o Content-Length quando um proxy encurtou o corpo", () => {
        const intact = sdpLines.map((l) => `${l}\r\n`).join("");
        const shortened = sdpLines.map((l) => (l === "a=sendonly" ? `${l}\n` : `${l}\r\n`)).join("");
        expect(shortened.length).toBe(intact.length - 1);

        const fixed = withActualContentLength(response(shortened, intact.length));

        expect(fixed).toContain(`Content-Length: ${shortened.length}\r\n`);
        expect(fixed.endsWith(shortened)).toBe(true);
    });

    it("conta bytes UTF-8, não caracteres", () => {
        const body = "nome=João\r\n";
        expect(withActualContentLength(response(body, 0))).toContain("Content-Length: 12\r\n");
    });

    it("deixa intacta uma mensagem sem corpo separado", () => {
        expect(withActualContentLength("SIP/2.0 100 Trying\r\nContent-Length: 0")).toBe("SIP/2.0 100 Trying\r\nContent-Length: 0");
    });
});
