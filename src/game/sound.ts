export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSubOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private muted: boolean;
  private initialized = false;

  constructor(muted = false) {
    this.muted = muted;
  }

  public unlock(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.42;
      master.connect(ctx.destination);
      this.masterGain = master;

      // Continuous turbine hover hum (modulated by craft speed & boost)
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 260;
      filter.Q.value = 3.2;

      const engGain = ctx.createGain();
      engGain.gain.value = 0.0;

      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 72;

      const subOsc = ctx.createOscillator();
      subOsc.type = 'triangle';
      subOsc.frequency.value = 36;

      osc.connect(filter);
      subOsc.connect(filter);
      filter.connect(engGain);
      engGain.connect(master);

      osc.start();
      subOsc.start();

      this.engineOsc = osc;
      this.engineSubOsc = subOsc;
      this.engineFilter = filter;
      this.engineGain = engGain;
      this.initialized = true;
    } catch {
      // Audio unavailable in headless or blocked contexts
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.42, this.ctx.currentTime, 0.04);
    }
  }

  public updateEngine(speedRatio: number, isBoosting: boolean, active: boolean): void {
    if (!this.ctx || !this.engineOsc || !this.engineSubOsc || !this.engineFilter || !this.engineGain) return;
    const now = this.ctx.currentTime;
    if (!active) {
      this.engineGain.gain.setTargetAtTime(0.0, now, 0.12);
      return;
    }
    const baseFreq = 64 + speedRatio * 74 + (isBoosting ? 34 : 0);
    this.engineOsc.frequency.setTargetAtTime(baseFreq, now, 0.06);
    this.engineSubOsc.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.06);
    this.engineFilter.frequency.setTargetAtTime(
      240 + speedRatio * 480 + (isBoosting ? 550 : 0),
      now,
      0.06,
    );
    this.engineGain.gain.setTargetAtTime(isBoosting ? 0.17 : 0.09, now, 0.08);
  }

  public playRingPass(combo: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Pentatonic rising triad based on combo
    const semitones = Math.min(combo, 12);
    const root = 392 * Math.pow(2, (semitones % 8) / 12);
    const freqs = [root, root * 1.25, root * 1.5];

    freqs.forEach((f, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'triangle';
      const t0 = now + idx * 0.038;
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * 1.04, t0 + 0.22);

      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t0);
      osc.stop(t0 + 0.3);
    });
  }

  public playCrystal(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(784, now);
    osc.frequency.exponentialRampToValueAtTime(1175, now + 0.11);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playRepair(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      const t = now + i * 0.045;
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.24);
    });
  }

  public playNearMiss(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.18);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  public playJump(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.22);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  public playBoostStart(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(220, now);
    filter.frequency.exponentialRampToValueAtTime(1400, now + 0.28);

    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.28);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.36);
  }

  public playCollision(fatal: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const duration = fatal ? 0.55 : 0.28;

    // Noise burst for metallic crunch
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(fatal ? 900 : 1200, now);
    filter.frequency.exponentialRampToValueAtTime(140, now + duration);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(fatal ? 0.42 : 0.3, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.masterGain);
    noise.start(now);

    // Low impact thud
    const sub = this.ctx.createOscillator();
    const sGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(135, now);
    sub.frequency.exponentialRampToValueAtTime(34, now + duration);
    sGain.gain.setValueAtTime(0.35, now);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    sub.connect(sGain);
    sGain.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + duration + 0.02);
  }

  public dispose(): void {
    try {
      this.engineOsc?.stop();
      this.engineSubOsc?.stop();
      void this.ctx?.close();
    } catch {
      // Already closed
    }
    this.ctx = null;
    this.initialized = false;
  }
}
