import {
    UserAgent,
    Registerer,
    RegistererRegisterOptions,
    UserAgentDelegate,
} from "sip.js";
import type { SipCredentials, SipRegisterResult } from "./types";
import { OutgoingRequestDelegate } from "sip.js/lib/core";

export async function register(
    {
        domain,
        phone,
        secret,
        nameexten,
        server,
        userAgentString = "sipjs-simple",
    }: SipCredentials,
    delegateUserAgent: UserAgentDelegate,
    delegateRegister: OutgoingRequestDelegate
): Promise<SipRegisterResult> {
    const uri = UserAgent.makeURI(`sip:${phone}@${domain}`);
    if (!uri) throw new Error("Invalid SIP URI");

    const userAgent = new UserAgent({
        displayName: nameexten ?? phone,
        authorizationUsername: phone,
        authorizationPassword: secret,
        uri,
        transportOptions: { server, traceSip: true },
        userAgentString,
        contactParams: { transport: "wss" },
        contactName: phone,
        delegate: delegateUserAgent,
        logLevel: "warn",
    });

    userAgent.contact.pubGruu = uri;
    userAgent.contact.tempGruu = uri;

    await userAgent.start();

    const registerer = new Registerer(userAgent, {
        expires: 3600,
        extraHeaders: ["Organization: @phs-santos"],
        extraContactHeaderParams: ["click2call=no"],
    });

    const options: RegistererRegisterOptions = {
        requestDelegate: delegateRegister,
        requestOptions: {
            extraHeaders: ["Px-Agent: 1.0"],
        },
    };

    await registerer.register(options);

    return { userAgent, registerer };
}
