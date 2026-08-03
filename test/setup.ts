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
