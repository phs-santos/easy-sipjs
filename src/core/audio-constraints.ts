/** Browser hints to reduce acoustic feedback in microphone capture. */
export function voiceCaptureConstraints(
    deviceId?: string
): MediaTrackConstraints {
    return {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(deviceId && deviceId !== "default"
            ? { deviceId: { exact: deviceId } }
            : {}),
    };
}
