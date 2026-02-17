import { useState, useEffect } from "react";
import { easySipService } from "./easy-sipjs.service";

export function useSip() {
    const [state, setState] = useState(easySipService.getState());

    useEffect(() => {
        const unsubscribe = easySipService.subscribe(() => {
            setState(easySipService.getState());
        });
        return () => { unsubscribe(); };
    }, []);

    return {
        ...state,
        register: easySipService.register.bind(easySipService),
        call: easySipService.call.bind(easySipService),
        answer: easySipService.answer.bind(easySipService),
        hangup: easySipService.hangup.bind(easySipService),
        switchSession: easySipService.switchSession.bind(easySipService),
        mute: easySipService.mute.bind(easySipService),
        muteVideo: easySipService.muteVideo.bind(easySipService),
        hold: easySipService.hold.bind(easySipService),
        clearLogs: easySipService.clearLogs.bind(easySipService),
        refreshAudioDevices: easySipService.refreshAudioDevices.bind(easySipService),
        setAudioOutputDevice: easySipService.setAudioOutputDevice.bind(easySipService),
    };
}
