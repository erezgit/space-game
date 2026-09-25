/**
 * Sound, generated in code — no audio files.
 *
 * Browsers only allow audio after a user gesture, so the context starts on the
 * first key press or touch. Every sound is a short synthesised envelope.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lockOsc: OscillatorNode | null = null;
  private lockGain: GainNode | null = null;
  private engine: { osc: OscillatorNode; gain: GainNode } | null = null;

  constructor() {
    const start = () => this.init();
    window.addEventListener("keydown", start, { once: true });
    window.addEventListener("touchstart", start, { once: true });
    window.addEventListener("mousedown", start, { once: true });
  }

  private init(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // A low jet rumble, always on.
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 55;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 180;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.05;
    osc.connect(lp).connect(gain).connect(this.master);
    osc.start();
    this.engine = { osc, gain };

    // The lock tone, silent until needed.
    this.lockOsc = this.ctx.createOscillator();
    this.lockOsc.type = "square";
    this.lockOsc.frequency.value = 1000;
    this.lockGain = this.ctx.createGain();
    this.lockGain.gain.value = 0;
    this.lockOsc.connect(this.lockGain).connect(this.master);
    this.lockOsc.start();
  }

  private burst(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = "lowpass", sweepTo?: number): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
  }

  gun(): void { this.burst(0.07, 1800, 0.8, 0.12, "bandpass"); }
  explosion(big = false): void { this.burst(big ? 1.6 : 0.9, big ? 500 : 800, 0.7, big ? 0.9 : 0.5, "lowpass", 60); }
  hit(): void { this.burst(0.25, 400, 1.5, 0.6, "lowpass", 80); }
  missile(): void { this.burst(1.3, 300, 0.9, 0.55, "bandpass", 2400); }

  /** Lock tone: 0 = off, 1 = seeking (slow pulse), 2 = locked (fast, high). */
  setLock(state: 0 | 1 | 2, t: number): void {
    if (!this.lockGain || !this.lockOsc) return;
    if (state === 0) { this.lockGain.gain.value = 0; return; }
    const on = state === 2 ? Math.sin(t * 40) > 0 : Math.sin(t * 14) > 0.6;
    this.lockOsc.frequency.value = state === 2 ? 1500 : 950;
    this.lockGain.gain.value = on ? 0.06 : 0;
  }

  setEngine(speed: number): void {
    if (!this.engine) return;
    this.engine.osc.frequency.value = 45 + speed * 0.6;
  }
}
