import { SoftphoneDevice } from "./types.js";

type DeviceListener = (devices: SoftphoneDevice[]) => void;

export class DeviceManager {
    private listeners = new Set<DeviceListener>();
    private cleanupDeviceChange?: () => void;

    async requestPermissions(options: MediaStreamConstraints = { audio: true, video: false }): Promise<boolean> {
        if (!navigator?.mediaDevices?.getUserMedia) return false;
        try {
            const stream = await navigator.mediaDevices.getUserMedia(options);
            stream.getTracks().forEach(track => track.stop());
            await this.emitChange();
            return true;
        } catch {
            return false;
        }
    }

    async list(): Promise<SoftphoneDevice[]> {
        if (!navigator?.mediaDevices?.enumerateDevices) return [];
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices
            .filter(device => ["audioinput", "audiooutput", "videoinput"].includes(device.kind))
            .map(device => ({
                id: device.deviceId,
                label: device.label || labelFor(device),
                kind: toKind(device.kind),
                rawKind: device.kind,
                isDefault: device.deviceId === "default",
            }));
    }

    async microphones(): Promise<SoftphoneDevice[]> {
        return (await this.list()).filter(device => device.kind === "microphone");
    }

    async speakers(): Promise<SoftphoneDevice[]> {
        return (await this.list()).filter(device => device.kind === "speaker");
    }

    async cameras(): Promise<SoftphoneDevice[]> {
        return (await this.list()).filter(device => device.kind === "camera");
    }

    watch(): () => void {
        if (this.cleanupDeviceChange) return this.cleanupDeviceChange;
        if (!navigator?.mediaDevices?.addEventListener) return () => undefined;

        const handler = () => { void this.emitChange(); };
        navigator.mediaDevices.addEventListener("devicechange", handler);
        this.cleanupDeviceChange = () => {
            navigator.mediaDevices.removeEventListener("devicechange", handler);
            this.cleanupDeviceChange = undefined;
        };
        return this.cleanupDeviceChange;
    }

    onChanged(listener: DeviceListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private async emitChange(): Promise<void> {
        const devices = await this.list();
        for (const listener of [...this.listeners]) {
            try { listener(devices); } catch (error) { queueMicrotask(() => { throw error; }); }
        }
    }
}

function toKind(kind: MediaDeviceKind): SoftphoneDevice["kind"] {
    if (kind === "audioinput") return "microphone";
    if (kind === "audiooutput") return "speaker";
    return "camera";
}

function labelFor(device: MediaDeviceInfo): string {
    if (device.kind === "audioinput") return "Microfone sem permissão";
    if (device.kind === "audiooutput") return "Alto-falante sem permissão";
    return "Câmera sem permissão";
}
