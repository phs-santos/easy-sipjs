class FakeMediaStream {
    private tracks: unknown[];
    constructor(tracks: unknown[] = []) {
        this.tracks = tracks;
    }
    getTracks() {
        return this.tracks;
    }
    getAudioTracks() {
        return this.tracks.filter((t: any) => t.kind === "audio");
    }
    getVideoTracks() {
        return this.tracks.filter((t: any) => t.kind === "video");
    }
}

(globalThis as any).MediaStream = (globalThis as any).MediaStream ?? FakeMediaStream;

if (!(globalThis as any).navigator) {
    (globalThis as any).navigator = {};
}
if (!(globalThis as any).navigator.mediaDevices) {
    (globalThis as any).navigator.mediaDevices = {};
}
if (!(globalThis as any).navigator.mediaDevices.getUserMedia) {
    (globalThis as any).navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error("getUserMedia not mocked for this test"));
}
if (!(globalThis as any).navigator.mediaDevices.getDisplayMedia) {
    (globalThis as any).navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new Error("getDisplayMedia not mocked for this test"));
}
