/**
 * Procedural Web Audio API sound engine for STARFALL.
 * Zero external audio file dependencies. Respects browser autoplay restrictions
 * by lazily unlocking AudioContext on the first user gesture.
 */
class AudioManagerImpl {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOscA: OscillatorNode | null = null;
  private engineOscB: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  private boostGain: GainNode | null = null;
  private boostFilter: BiquadFilterNode | null = null;
  private boostSubOsc: OscillatorNode | null = null;
  private boostSubGain: GainNode | null = null;

  private masterVolume = 0.65;
  private engineRunning = false;
  private initialized = false;
  private sharedNoiseBuffer: AudioBuffer | null = null;
  private lastEnemyShotSound = 0;
  private lastImpactSound = 0;

  /**
   * Must be invoked from a direct user gesture (click / keydown) to satisfy autoplay rules.
   */
  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.setupGraph(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {
        // Ignore resume rejection if not in gesture
      });
    }
  }

  private setupGraph(ctx: AudioContext): void {
    if (this.initialized) return;
    this.initialized = true;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.masterVolume;
    this.masterGain.connect(ctx.destination);

    // 1. Continuous Sci-Fi Ion Engine Synth
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 180;
    this.engineFilter.Q.value = 3.2;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0001;

    this.engineOscA = ctx.createOscillator();
    this.engineOscA.type = 'sawtooth';
    this.engineOscA.frequency.value = 62;

    this.engineOscB = ctx.createOscillator();
    this.engineOscB.type = 'triangle';
    this.engineOscB.frequency.value = 124.8;

    this.engineOscA.connect(this.engineFilter);
    this.engineOscB.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.engineOscA.start();
    this.engineOscB.start();

    // 2. Shared Filtered Noise Buffer (Boost Afterburner + Explosions + Impacts)
    const bufferLen = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferLen, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferLen; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.08 * white) / 1.08;
      data[i] = lastOut * 2.8;
    }
    this.sharedNoiseBuffer = noiseBuffer;

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    noiseSrc.loop = true;

    this.boostFilter = ctx.createBiquadFilter();
    this.boostFilter.type = 'bandpass';
    this.boostFilter.frequency.value = 420;
    this.boostFilter.Q.value = 0.85;

    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0.0001;

    noiseSrc.connect(this.boostFilter);
    this.boostFilter.connect(this.boostGain);
    this.boostGain.connect(this.masterGain);
    noiseSrc.start();

    this.boostSubOsc = ctx.createOscillator();
    this.boostSubOsc.type = 'sine';
    this.boostSubOsc.frequency.value = 95;
    this.boostSubGain = ctx.createGain();
    this.boostSubGain.gain.value = 0.0001;
    this.boostSubOsc.connect(this.boostSubGain);
    this.boostSubGain.connect(this.masterGain);
    this.boostSubOsc.start();
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.03);
    }
  }

  public setFlightAudioActive(active: boolean): void {
    this.engineRunning = active;
    if (!active && this.ctx && this.engineGain && this.boostGain && this.boostSubGain) {
      const now = this.ctx.currentTime;
      this.engineGain.gain.setTargetAtTime(0.0001, now, 0.08);
      this.boostGain.gain.setTargetAtTime(0.0001, now, 0.06);
      this.boostSubGain.gain.setTargetAtTime(0.0001, now, 0.06);
    }
  }

  public updateFlightAudio(speedRatio: number, boostIntensity: number, throttle: number): void {
    if (!this.engineRunning || !this.ctx || this.ctx.state !== 'running') return;
    if (
      !this.engineOscA ||
      !this.engineOscB ||
      !this.engineFilter ||
      !this.engineGain ||
      !this.boostGain ||
      !this.boostFilter ||
      !this.boostSubOsc ||
      !this.boostSubGain
    ) {
      return;
    }

    const now = this.ctx.currentTime;
    const clampedSpeed = Math.max(0, Math.min(2, speedRatio));
    const clampedBoost = Math.max(0, Math.min(1, boostIntensity));

    const baseFreq = 54 + clampedSpeed * 42 + clampedBoost * 28 + (throttle > 0 ? 8 : 0);
    this.engineOscA.frequency.setTargetAtTime(baseFreq, now, 0.06);
    this.engineOscB.frequency.setTargetAtTime(baseFreq * 2.01, now, 0.06);
    this.engineFilter.frequency.setTargetAtTime(
      170 + clampedSpeed * 320 + clampedBoost * 680,
      now,
      0.06,
    );
    this.engineGain.gain.setTargetAtTime(
      0.045 + clampedSpeed * 0.055 + clampedBoost * 0.05,
      now,
      0.07,
    );

    this.boostFilter.frequency.setTargetAtTime(340 + clampedBoost * 780, now, 0.05);
    this.boostGain.gain.setTargetAtTime(clampedBoost * 0.22, now, 0.05);
    this.boostSubOsc.frequency.setTargetAtTime(84 + clampedBoost * 58, now, 0.06);
    this.boostSubGain.gain.setTargetAtTime(clampedBoost * 0.09, now, 0.06);
  }

  public playBoostEngage(): void {
    if (!this.ctx || this.ctx.state !== 'running' || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.16);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.34);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(220, now + 0.35);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.38);
  }

  /**
   * Crisp futuristic twin-pulse plasma cannon discharge.
   */
  public playPlayerLaser(): void {
    if (!this.ctx || this.ctx.state !== 'running' || !this.masterGain) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const sub = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    const pitchJitter = 0.96 + Math.random() * 0.08;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1180 * pitchJitter, now);
    osc.frequency.exponentialRampToValueAtTime(210 * pitchJitter, now + 0.11);

    sub.type = 'triangle';
    sub.frequency.setValueAtTime(320 * pitchJitter, now);
    sub.frequency.exponentialRampToValueAtTime(90, now + 0.09);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1600, now);
    filter.frequency.exponentialRampToValueAtTime(420, now + 0.11);
    filter.Q.value = 1.4;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.13, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.125);

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    sub.start(now);
    osc.stop(now + 0.135);
    sub.stop(now + 0.135);
  }

  /**
   * Distance-attenuated hostile plasma burst (rate-limited to prevent overlapping audio clutter).
   */
  public playEnemyLaser(distance: number): void {
    if (!this.ctx || this.ctx.state !== 'running' || !this.masterGain) return;
    const now = this.ctx.currentTime;
    if (now - this.lastEnemyShotSound < 0.09) return;
    const atten = Math.max(0, 1 - distance / 420);
    if (atten <= 0.05) return;
    this.lastEnemyShotSound = now;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.09);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1100, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.065 * atten, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  /**
   * Crisp tactical hit confirmation ping (higher harmonic chime on kill).
   */
  public playImpactHit(isKill = false): void {
    if (!this.ctx || this.ctx.state !== 'running' || !this.masterGain) return;
    const now = this.ctx.currentTime;
    if (!isKill && now - this.lastImpactSound < 0.055) return;
    this.lastImpactSound = now;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = isKill ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(isKill ? 980 : 1420, now);
    osc.frequency.exponentialRampToValueAtTime(isKill ? 1560 : 620, now + (isKill ? 0.14 : 0.055));

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(isKill ? 0.12 : 0.08, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (isKill ? 0.16 : 0.065));

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  /**
   * Heavy metallic hull impact thud + shield warning tone when player receives damage.
   */
  public playPlayerDamage(): void {
    if (!this.ctx || this.ctx.state !== 'running' || !this.masterGain) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(165, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.22);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(540, now);
    filter.frequency.exponentialRampToValueAtTime(110, now + 0.22);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.27);
  }

  public playShieldBreak(): void {
    if (!this.ctx || this.ctx.state !== 'running' || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.42);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, now);
    filter.frequency.exponentialRampToValueAtTime(360, now + 0.42);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.44);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.46);
  }

  public playShieldHit(): void {
    if (!this.ctx || this.ctx.state !== 'running' || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1120, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.09);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.055, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  /**
   * Cinematic deep-space hull detonation (sub-bass boom + filtered plasma crackle).
   */
  public playExplosion(distance = 80): void {
    if (!this.ctx || this.ctx.state !== 'running' || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const atten = Math.max(0.22, Math.min(1, 1 - distance / 680));

    // Sub-bass shockwave
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.65);

    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.linearRampToValueAtTime(0.28 * atten, now + 0.02);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);

    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.75);

    // Filtered explosion rumble using shared noise buffer
    if (this.sharedNoiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.sharedNoiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1250, now);
      filter.frequency.exponentialRampToValueAtTime(95, now + 0.85);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.001, now);
      nGain.gain.linearRampToValueAtTime(0.32 * atten, now + 0.025);
      nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);

      src.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.masterGain);
      src.start(now);
      src.stop(now + 0.92);
    }
  }

  public playUiHover(): void {
    this.unlock();
    if (!this.ctx || this.ctx.state !== 'running' || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(920, now + 0.04);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.045, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  public playUiClick(variant: 'primary' | 'secondary' | 'pause' = 'primary'): void {
    this.unlock();
    if (!this.ctx || this.ctx.state !== 'running' || !this.masterGain) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = variant === 'primary' ? 'triangle' : 'sine';

    if (variant === 'primary') {
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(840, now + 0.075);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.11, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    } else if (variant === 'pause') {
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    } else {
      osc.frequency.setValueAtTime(540, now);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.055);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.075, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    }

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public dispose(): void {
    this.setFlightAudioActive(false);
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
      this.sharedNoiseBuffer = null;
      this.initialized = false;
    }
  }
}

export const AudioManager = new AudioManagerImpl();
