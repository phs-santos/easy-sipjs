import { SessionState, Web, Session } from "sip.js";

export function handleStateChanges(
    session: Session,
    local?: HTMLMediaElement,
    remote?: HTMLMediaElement
): void {
    session.stateChange.addListener((state: SessionState) => {
        switch (state) {
            case SessionState.Established:
                const handler = session.sessionDescriptionHandler;
                if (!handler || !(handler instanceof Web.SessionDescriptionHandler)) {
                    throw new Error("Invalid session description handler.");
                }
                if (local) assignStream(handler.localMediaStream, local);
                if (remote) assignStream(handler.remoteMediaStream, remote);
                break;
            case SessionState.Terminated:
                console.log("Session terminated");
                break;
        }
    });
}

export function assignStream(stream: MediaStream, element: HTMLMediaElement): void {
    element.autoplay = true;
    element.srcObject = stream;
    element.play().catch(err => console.error("Media play failed:", err));

    stream.onaddtrack = () => element.play().catch(console.error);
    stream.onremovetrack = () => element.play().catch(console.error);
}
