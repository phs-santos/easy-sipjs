import { Inviter, UserAgent } from "sip.js";
import { handleStateChanges } from "./media";
import type { CallOptions } from "./types";

export async function call(userAgent: UserAgent, options: CallOptions): Promise<Inviter> {
    const { destination, localElement, remoteElement, video } = options;

    const target = UserAgent.makeURI(destination);
    if (!target) throw new Error("Invalid destination URI");

    const inviter = new Inviter(userAgent, target);

    handleStateChanges(inviter, localElement, remoteElement);

    await inviter.invite({
        sessionDescriptionHandlerOptions: { constraints: { audio: true, video: !!video } },
    });

    return inviter;
}
