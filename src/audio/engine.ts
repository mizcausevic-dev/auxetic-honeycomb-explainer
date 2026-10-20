import { cuesBetween } from "../model/timeline";

type Shot = { stop: (when?: number) => void };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoother(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export class Score {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private sfx: GainNode | null = null;
  private drone: OscillatorNode | null = null;
  private fifth: OscillatorNode | null = null;
  private partial: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;
  private fifthGain: GainNode | null = null;
  private partialGain: GainNode | null = null;
  private shots: Shot[] = [];
  private lastT = 0;
  private muted = false;
  private musicLevel = 0.75;
  private sfxLevel = 0.7;
  unlocked = false;

  async unlock() {
    if (this.unlocked) {
      if (this.ctx?.state === "suspended") await this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    const music = ctx.createGain();
    const sfx = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 8;
    comp.ratio.value = 2.2;
    comp.attack.value = 0.01;
    comp.release.value = 0.18;
    music.connect(master);
    sfx.connect(master);
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;
    this.music = music;
    this.sfx = sfx;
    this.applyLevels();

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    const rand = mulberry32(0xA07E71C);
    for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noise;
    noiseSrc.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.015;
    noiseSrc.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(music);
    noiseSrc.start();

    this.droneGain = ctx.createGain();
    this.fifthGain = ctx.createGain();
    this.partialGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.fifthGain.gain.value = 0;
    this.partialGain.gain.value = 0;
    this.drone = ctx.createOscillator();
    this.fifth = ctx.createOscillator();
    this.partial = ctx.createOscillator();
    this.drone.type = "sine";
    this.fifth.type = "sine";
    this.partial.type = "triangle";
    this.drone.frequency.value = 73.42;
    this.fifth.frequency.value = 110;
    this.partial.frequency.value = 174.61;
    this.drone.connect(this.droneGain);
    this.fifth.connect(this.fifthGain);
    this.partial.connect(this.partialGain);
    this.droneGain.connect(music);
    this.fifthGain.connect(music);
    this.partialGain.connect(music);
    this.drone.start();
    this.fifth.start();
    this.partial.start();
    this.unlocked = true;
    if (ctx.state === "suspended") await ctx.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyLevels();
  }

  setMusic(level: number) {
    this.musicLevel = level;
    this.applyLevels();
  }

  setSfx(level: number) {
    this.sfxLevel = level;
    this.applyLevels();
  }

  private applyLevels() {
    if (!this.master || !this.music || !this.sfx || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, now, 0.03);
    this.music.gain.setTargetAtTime(this.musicLevel, now, 0.03);
    this.sfx.gain.setTargetAtTime(this.sfxLevel, now, 0.03);
  }

  pause() {
    void this.ctx?.suspend();
  }

  async resume() {
    if (this.ctx?.state === "suspended") await this.ctx.resume();
  }

  seek(t: number) {
    this.stopShots();
    this.lastT = t;
    this.applyBed(t);
  }

  update(t: number, playing: boolean) {
    if (!this.unlocked || !this.ctx) {
      this.lastT = t;
      return;
    }
    this.applyBed(t);
    if (playing && t > this.lastT) {
      for (const cue of cuesBetween(this.lastT, t)) this.playCue(cue.id);
      for (const mark of [4, 8, 12, 16, 20, 24, 28, 32]) {
        if (mark >= this.lastT && mark < t) this.tick(mark);
      }
    }
    this.lastT = t;
    if (t >= 34) this.stopShots();
  }

  private applyBed(t: number) {
    if (!this.ctx || !this.droneGain || !this.fifthGain || !this.partialGain || !this.partial) return;
    const now = this.ctx.currentTime;
    const env = smoother(0.15, 2.4, t) * (1 - smoother(32.4, 34, t));
    const swell = 1 + 0.22 * smoother(10, 22.5, Math.min(t, 25));
    this.droneGain.gain.setTargetAtTime(0.055 * env * swell, now, 0.05);
    this.fifthGain.gain.setTargetAtTime(0.028 * env, now, 0.05);
    this.partialGain.gain.setTargetAtTime(0.02 * env * (t > 5 ? 1 : 0.4), now, 0.08);
    const freq = t < 5 ? 174.6 : t < 10 ? 220 : t < 17 ? 293.7 : t < 25 ? 349.2 : t < 31.6 ? 220 : 146.8;
    this.partial.frequency.setTargetAtTime(freq, now, 0.08);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = "sine", glide?: number, delay = 0) {
    if (!this.ctx || !this.sfx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, glide), t0 + dur);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp);
    amp.connect(this.sfx);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    const shot = {
      stop: () => {
        try {
          osc.stop();
        } catch {
          /* already stopped */
        }
      },
    };
    this.shots.push(shot);
    osc.onended = () => {
      this.shots = this.shots.filter((item) => item !== shot);
    };
  }

  private playCue(id: string) {
    if (id === "cell") {
      this.tone(660, 0.42, 0.045);
      this.tone(990, 0.36, 0.03);
    } else if (id === "load") {
      this.tone(150, 0.5, 0.05, "sine", 78);
    } else if (id === "guides") {
      this.tone(880, 0.16, 0.04);
      this.tone(1244, 0.18, 0.035, "sine", undefined, 0.12);
    } else if (id === "hold") {
      this.tone(587, 0.7, 0.04);
      this.tone(880, 0.62, 0.025);
    } else if (id === "unload") {
      this.tone(210, 0.55, 0.045, "sine", 98);
    } else if (id === "compare") {
      this.tone(523.25, 0.48, 0.04);
      this.tone(659.25, 0.42, 0.028);
    }
  }

  private tick(mark: number) {
    const freq = mark % 8 === 0 ? 392 : 329.6;
    this.tone(freq, 0.09, 0.02, "sine");
  }

  private stopShots() {
    for (const shot of this.shots) shot.stop();
    this.shots = [];
  }
}
