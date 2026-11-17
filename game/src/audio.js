// Synthesized sound for SOLMAR BAY: every sound is generated with the Web Audio API.
// No audio files are loaded. Music is a simple original bass-and-keys loop.
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.musicTimer = null;
    this.musicOn = false;
    this.musicStep = 0;
    this.enabled = true;
  }

  /** Must be called from a user gesture at least once. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    // Engine hum: a sawtooth whose pitch follows speed, plus a low sine.
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    const engineFilter = this.ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(engineFilter);
    engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    // Police siren: two alternating tones.
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 700;
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.master);
    this.sirenOsc.start();
    this.sirenPhase = 0;
  }

  setEngine(speedNorm, driving) {
    if (!this.ctx || !this.engineOsc) return;
    const target = driving ? 0.05 + 0.09 * speedNorm : 0.0;
    this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
    this.engineOsc.frequency.setTargetAtTime(48 + speedNorm * 160, this.ctx.currentTime, 0.08);
  }

  setSiren(on, dt) {
    if (!this.ctx || !this.sirenOsc) return;
    this.sirenPhase = (this.sirenPhase || 0) + dt;
    const high = Math.floor(this.sirenPhase * 1.6) % 2 === 0;
    this.sirenOsc.frequency.setTargetAtTime(high ? 880 : 620, this.ctx.currentTime, 0.05);
    this.sirenGain.gain.setTargetAtTime(on ? 0.045 : 0, this.ctx.currentTime, 0.2);
  }

  /** Short noise burst (gunshot, impact). */
  burst(duration, freq, gain, type = 'lowpass') {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t);
  }

  /** A pure tone blip (pickup chime, UI click, mission sting). */
  tone(freq, duration, gain, type = 'sine', slideTo = null) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + duration + 0.02);
  }

  gunshot() { this.burst(0.14, 1800, 0.5, 'lowpass'); this.tone(180, 0.08, 0.25, 'square'); }
  enemyShot() { this.burst(0.12, 1400, 0.22, 'lowpass'); }
  punch() { this.burst(0.09, 500, 0.35, 'lowpass'); }
  crash() { this.burst(0.3, 700, 0.5, 'lowpass'); this.tone(90, 0.25, 0.3, 'sawtooth', 40); }
  pickup() { this.tone(880, 0.12, 0.2); setTimeout(() => this.tone(1318, 0.18, 0.2), 90); }
  cash() { this.tone(1046, 0.1, 0.2); setTimeout(() => this.tone(1568, 0.22, 0.2), 80); }
  click() { this.tone(660, 0.05, 0.12, 'square'); }
  missionStart() { this.tone(523, 0.14, 0.2); setTimeout(() => this.tone(784, 0.2, 0.2), 130); }
  missionPass() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 0.22), i * 120));
  }
  missionFail() { this.tone(392, 0.3, 0.22, 'sawtooth', 196); }
  wantedUp() { this.tone(220, 0.12, 0.2, 'square'); setTimeout(() => this.tone(220, 0.12, 0.2, 'square'), 140); }

  /** Original lo-fi bass loop: Am – F – C – G roots with a soft pluck. */
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    const roots = [110, 87.31, 130.81, 98];
    const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];
    this.musicTimer = setInterval(() => {
      if (!this.enabled || !this.ctx) return;
      const bar = Math.floor(this.musicStep / 8) % 4;
      const beat = this.musicStep % 8;
      if (beat === 0 || beat === 3 || beat === 6) this.tone(roots[bar], 0.4, 0.16, 'triangle');
      if (beat % 2 === 0) this.tone(chords[bar][beat % 3] / 2, 0.25, 0.05, 'sine');
      this.musicStep += 1;
    }, 300);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.musicOn = false;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
  }
}
