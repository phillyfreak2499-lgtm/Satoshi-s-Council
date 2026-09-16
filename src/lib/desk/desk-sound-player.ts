import type { DeskCue } from "./desk-sound-events";

export const DEFAULT_DESK_VOLUME = 25;
export function safeDeskVolume(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : DEFAULT_DESK_VOLUME;
}

/** Original, deterministic short instrument sounds. No downloads, tracking,
 * voice, music, or audio generated from prices. Both settlement outcomes use
 * precisely the same waveform. Every envelope fades to silence. */
export function renderDeskCue(kind: DeskCue, sampleRate = 24000): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new RangeError("Invalid sample rate");
  const duration = kind === "paper-fill" ? 0.46 : kind === "settlement" ? 0.65 : 0.72;
  const data = new Float32Array(Math.ceil(sampleRate * duration));
  const note = (frequency: number, start: number, length: number, amplitude: number, decay: number, glass = false) => {
    const begin = Math.round(start * sampleRate);
    const count = Math.min(data.length - begin, Math.round(length * sampleRate));
    for (let i = 0; i < count; i++) {
      const t = i / sampleRate;
      const envelope = Math.min(1, t / 0.005) * Math.exp(-decay * t) * Math.min(1, (count - 1 - i) / (sampleRate * 0.035));
      const tone = Math.sin(2 * Math.PI * frequency * t) + (glass ? 0.16 * Math.sin(2 * Math.PI * frequency * 2.013 * t) * Math.exp(-8 * t) : 0);
      data[begin + i] += amplitude * envelope * tone;
    }
  };
  if (kind === "chair-up" || kind === "chair-down") {
    const notes = kind === "chair-up" ? [659.25, 880] : [880, 659.25];
    note(notes[0], 0, 0.4, 0.22, 9, true);
    note(notes[1], 0.15, 0.57, 0.20, 8, true);
  } else if (kind === "paper-fill") {
    // A damped wooden impact, rather than a loud courtroom bang.
    note(185, 0, 0.42, 0.29, 20);
    note(317, 0, 0.30, 0.15, 27);
    note(729, 0, 0.19, 0.07, 35);
    let seed = 73421;
    let filtered = 0;
    for (let i = 0; i < sampleRate * 0.08; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      filtered = 0.7 * filtered + 0.3 * (seed / 2147483648 - 1);
      const t = i / sampleRate;
      data[i] += 0.13 * filtered * Math.min(1, t / 0.002) * Math.exp(-75 * t);
    }
  } else {
    // One neutral acknowledgment. Not a win fanfare or a loss alarm.
    note(523.25, 0, 0.65, 0.17, 9, true);
    note(783.99, 0, 0.54, 0.08, 10, true);
  }
  for (let i = 0; i < data.length; i++) data[i] = Math.tanh(data[i]) * 0.7;
  return data;
}

/** Created only after an explicit Enable or Preview click, never on mount. */
export class DeskSoundPlayer {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private buffers = new Map<DeskCue, AudioBuffer>();
  private sources = new Set<AudioBufferSourceNode>();
  private disposed = false;

  async unlock(): Promise<void> {
    if (this.disposed) throw new Error("Audio closed");
    const Audio = typeof window === "undefined" ? undefined : window.AudioContext;
    if (!Audio) throw new Error("This browser does not support desk sounds.");
    if (!this.context) {
      this.context = new Audio();
      this.gain = this.context.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.context.destination);
    }
    if (this.context.state !== "running") await this.context.resume();
    if (this.disposed || this.context.state !== "running") throw new Error("Sound is blocked. Try enabling it again.");
  }

  isRunning(): boolean { return !this.disposed && this.context?.state === "running"; }

  setVolume(volume: number): void {
    if (!this.gain || !this.context || this.disposed) return;
    this.gain.gain.setTargetAtTime(safeDeskVolume(volume) / 100 * 0.7, this.context.currentTime, 0.015);
  }

  play(kind: DeskCue, volume: number): boolean {
    const ctx = this.context;
    const gain = this.gain;
    if (!ctx || !gain || !this.isRunning() || safeDeskVolume(volume) === 0) return false;
    this.stop();
    let buffer = this.buffers.get(kind);
    if (!buffer) {
      const samples = renderDeskCue(kind);
      buffer = ctx.createBuffer(1, samples.length, 24000);
      buffer.getChannelData(0).set(samples);
      this.buffers.set(kind, buffer);
    }
    this.setVolume(volume);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    this.sources.add(source);
    source.onended = () => { source.disconnect(); this.sources.delete(source); };
    source.start();
    return true;
  }

  stop(): void {
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* already ended */ }
      source.disconnect();
    }
    this.sources.clear();
    if (this.gain && this.context && !this.disposed) {
      this.gain.gain.cancelScheduledValues(this.context.currentTime);
      this.gain.gain.setValueAtTime(0, this.context.currentTime);
    }
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.buffers.clear();
    const context = this.context;
    this.context = null;
    this.gain = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }
}
