import { SessionState, Web, Session } from "sip.js";

export function handleStateChanges(
    session: Session,
    local?: HTMLMediaElement,
    remote?: HTMLMediaElement,
    onTerminate?: () => void
): void {
    session.stateChange.addListener((state: SessionState) => {
        switch (state) {
            case SessionState.Established: {
                const handler = session.sessionDescriptionHandler;
                if (!handler || !(handler instanceof Web.SessionDescriptionHandler)) {
                    console.error("easy-sipjs: Invalid session description handler — terminating session.");
                    if (onTerminate) onTerminate();
                    return;
                }
                if (local) assignStream(handler.localMediaStream, local);
                if (remote) assignStream(handler.remoteMediaStream, remote);

                const pc = handler.peerConnection;
                if (pc && remote) {
                    pc.addEventListener("track", (event) => {
                        if (event.streams && event.streams[0]) {
                            assignStream(event.streams[0], remote);
                        }
                    });
                }
                break;
            }
            case SessionState.Terminated:
                if (onTerminate) onTerminate();
                break;
        }
    });
}

export function assignStream(stream: MediaStream, element: HTMLMediaElement): void {
    element.autoplay = true;
    if (element.srcObject !== stream) {
        element.srcObject = stream;
    }
    element.play().catch(err => console.error("Media play failed:", err));

    stream.onaddtrack = () => element.play().catch(console.error);
    stream.onremovetrack = () => element.play().catch(console.error);
}
