import "./style.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/jetbrains-mono/500.css";
import { segmentCrossings, auxeticLattice, AUXETIC_SPEC } from "./model/kinematics";
import { COPY, DURATION, sceneState, type SceneState } from "./model/timeline";
import { createView, type View } from "./render/scene";
import { paintComparison, paintStage } from "./render/schematic";
import { Score } from "./audio/engine";

const reducedMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
const lite =
  new URLSearchParams(location.search).has("lite") ||
  window.matchMedia("(max-width: 720px)").matches ||
  (navigator.hardwareConcurrency || 8) <= 4;

const canvas = document.querySelector<HTMLCanvasElement>("#view");
const fallback = document.querySelector<HTMLCanvasElement>("#fallback");
const loader = document.querySelector<HTMLElement>("#loader");
const errorBox = document.querySelector<HTMLElement>("#error");
const caption = document.querySelector<HTMLElement>("#caption");
const shotKicker = document.querySelector<HTMLElement>("#shot-kicker");
const timeReadout = document.querySelector<HTMLElement>("#time-readout");
const timeline = document.querySelector<HTMLInputElement>("#timeline");
const playBtn = document.querySelector<HTMLButtonElement>("#play");
const replayBtn = document.querySelector<HTMLButtonElement>("#replay");
const muteBtn = document.querySelector<HTMLButtonElement>("#mute");
const fullBtn = document.querySelector<HTMLButtonElement>("#fullscreen");
const motionBtn = document.querySelector<HTMLButtonElement>("#motion");
const musicSlider = document.querySelector<HTMLInputElement>("#music");
const sfxSlider = document.querySelector<HTMLInputElement>("#sfx");
const compare = document.querySelector<HTMLElement>("#compare");
const compareCanvas = document.querySelector<HTMLCanvasElement>("#compare-view");
const compareEps = document.querySelector<HTMLElement>("#compare-eps");
const nuReadout = document.querySelector<HTMLElement>("#nu-readout");
const hReadout = document.querySelector<HTMLElement>("#h-readout");
const wReadout = document.querySelector<HTMLElement>("#w-readout");
const h0Readout = document.querySelector<HTMLElement>("#h0-readout");
const w0Readout = document.querySelector<HTMLElement>("#w0-readout");
const eyReadout = document.querySelector<HTMLElement>("#ey-readout");
const exReadout = document.querySelector<HTMLElement>("#ex-readout");
const statusLine = document.querySelector<HTMLElement>("#status-line");

if (!canvas || !fallback || !timeline || !playBtn) {
  throw new Error("Required interface nodes are missing.");
}
const stage = fallback;
const clock = timeline;
const playButton = playBtn;

if (segmentCrossings(auxeticLattice, AUXETIC_SPEC.theta0) !== 0) {
  throw new Error("Rest pose has rib crossings.");
}

let view: View | null = null;
let useFallback = false;
const forceFallback = new URLSearchParams(location.search).has("fallback");
const gl = forceFallback ? null : canvas.getContext("webgl2", { antialias: true, alpha: false });
if (!gl) {
  useFallback = true;
} else {
  try {
    view = createView(canvas, lite);
  } catch (err) {
    useFallback = true;
    console.error(err);
  }
}

if (useFallback) {
  canvas.hidden = true;
  fallback.hidden = false;
  if (loader) loader.textContent = "WebGL is unavailable. Showing the orthographic model.";
}

const score = new Score();
let t = 0;
let playing = false;
let scrubbing = false;
let reduced = reducedMedia.matches;
let muted = false;
let lastNow = performance.now();
let lastAria = -1;
let started = false;

function fmt(v: number, digits = 3) {
  return v.toFixed(digits);
}

function fmtSigned(v: number) {
  const text = `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  return text;
}

function sync(state: SceneState) {
  if (view) view.render(state);
  else paintStage(stage, state);

  if (caption) caption.textContent = state.shot.caption;
  if (shotKicker) shotKicker.textContent = `Shot ${state.shot.id}  ${state.shot.title}`;
  if (timeReadout) timeReadout.textContent = `${fmt(state.t, 2)} / 34.00`;
  if (!scrubbing) clock.value = String(state.t);
  if (state.t - lastAria > 0.45 || state.t === 0) {
    clock.setAttribute(
      "aria-valuetext",
      `${state.t.toFixed(1)} seconds, shot ${state.shot.id}, ${state.shot.title}`,
    );
    lastAria = state.t;
  }
  if (h0Readout) h0Readout.textContent = fmt(state.H0);
  if (w0Readout) w0Readout.textContent = fmt(state.W0);
  if (hReadout) hReadout.textContent = fmt(state.H);
  if (wReadout) wReadout.textContent = fmt(state.W);
  if (eyReadout) eyReadout.textContent = fmtSigned(state.epsY);
  if (exReadout) exReadout.textContent = fmtSigned(state.epsX);
  if (nuReadout) nuReadout.textContent = state.nu === null ? "—" : state.nu.toFixed(2);
  if (statusLine) {
    statusLine.textContent = state.unloadCue
      ? "Unloading toward the initial grip position."
      : state.lambda > 0.98
        ? "Holding the illustrated extension."
        : useFallback
          ? "Orthographic fallback. The same kinematic model is driving the drawing."
          : "Central gauge. Model units.";
  }

  const showCompare = state.comparison.opacity > 0.02;
  if (compare && compareCanvas) {
    compare.hidden = !showCompare;
    // Full opacity promotes the canvas layer and this Chrome build then
    // paints a black copy of it above the specimen. 0.99 is visually solid.
    compare.style.opacity = String(Math.min(0.99, state.comparison.opacity));
    if (showCompare) {
      paintComparison(compareCanvas, state.comparison.auxTheta, state.comparison.convTheta);
      if (compareEps) compareEps.textContent = `εy ${fmtSigned(state.comparison.eps)}`;
    }
  }

  playButton.textContent = playing ? "Pause" : "Play";
  playButton.setAttribute("aria-pressed", playing ? "true" : "false");
  playButton.setAttribute("aria-label", playing ? "Pause animation" : "Play animation");
  if (motionBtn) motionBtn.setAttribute("aria-pressed", reduced ? "true" : "false");
  document.body.classList.toggle("is-reduced", reduced);
  document.body.dataset.shot = String(state.shot.id);
}

async function play() {
  if (t >= DURATION - 0.001) t = 0;
  await score.unlock();
  score.seek(t);
  await score.resume();
  playing = true;
  started = true;
  lastNow = performance.now();
}

function pause() {
  playing = false;
  score.pause();
}

function replay() {
  t = 0;
  score.seek(0);
  void play();
}

function nudge(delta: number) {
  t = Math.min(DURATION, Math.max(0, t + delta));
  score.seek(t);
  if (t >= DURATION) pause();
}

playButton.addEventListener("click", () => {
  if (playing) pause();
  else void play();
});
replayBtn?.addEventListener("click", () => replay());
muteBtn?.addEventListener("click", () => {
  muted = !muted;
  score.setMuted(muted);
  if (muteBtn) {
    muteBtn.textContent = muted ? "Unmute" : "Mute";
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    muteBtn.setAttribute("aria-label", muted ? "Unmute audio" : "Mute audio");
  }
});
musicSlider?.addEventListener("input", () => {
  score.setMusic(Number(musicSlider.value));
});
sfxSlider?.addEventListener("input", () => {
  score.setSfx(Number(sfxSlider.value));
});
motionBtn?.addEventListener("click", () => {
  reduced = !reduced;
  if (motionBtn) motionBtn.textContent = reduced ? "Motion on" : "Reduce motion";
});

const fullscreenTarget = document.querySelector<HTMLElement>("#app");
if (!fullBtn || !fullscreenTarget || !document.fullscreenEnabled) {
  fullBtn?.setAttribute("hidden", "");
} else {
  fullBtn.addEventListener("click", async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await fullscreenTarget.requestFullscreen();
  });
}

timeline.addEventListener("pointerdown", () => {
  scrubbing = true;
  score.seek(t);
});
timeline.addEventListener("input", () => {
  t = Number(timeline.value);
  score.seek(t);
  if (t >= DURATION) pause();
});
const endScrub = () => {
  scrubbing = false;
};
timeline.addEventListener("pointerup", endScrub);
timeline.addEventListener("pointercancel", endScrub);
timeline.addEventListener("keyup", endScrub);

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  const typing = target instanceof HTMLInputElement && target.type !== "range";
  if (typing) return;
  if (event.code === "Space") {
    event.preventDefault();
    if (playing) pause();
    else void play();
  } else if (event.code === "ArrowRight") {
    event.preventDefault();
    nudge(event.shiftKey ? 1 / 30 : event.altKey ? 0.1 : 0.5);
  } else if (event.code === "ArrowLeft") {
    event.preventDefault();
    nudge(event.shiftKey ? -1 / 30 : event.altKey ? -0.1 : -0.5);
  } else if (event.code === "Home") {
    event.preventDefault();
    replay();
  } else if (event.key === "m" || event.key === "M") {
    muteBtn?.click();
  } else if (event.key === "f" || event.key === "F") {
    fullBtn?.click();
  }
});

window.addEventListener("resize", () => view?.resize());

const api = {
  seek(time: number) {
    t = Math.min(DURATION, Math.max(0, time));
    score.seek(t);
  },
  play,
  pause,
  state: () => sceneState(t, reduced),
  time: () => t,
  usingFallback: () => useFallback,
};
Object.assign(window, { __AUXETIC__: api });

function frame(now: number) {
  const dt = Math.min(0.25, (now - lastNow) / 1000);
  lastNow = now;
  if (playing && !scrubbing) {
    t = Math.min(DURATION, t + dt);
    if (t >= DURATION) pause();
  }
  const state = sceneState(t, reduced);
  try {
    sync(state);
    score.update(t, playing && started);
    if (loader && !loader.hidden) {
      loader.hidden = true;
    }
  } catch (err) {
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = err instanceof Error ? err.message : "The view failed to render.";
    }
    console.error(err);
  }
  requestAnimationFrame(frame);
}

if (reduced && motionBtn) motionBtn.textContent = "Motion on";
requestAnimationFrame(frame);

document.querySelector("#copy-amplified")!.textContent = COPY.amplified;
document.querySelector("#copy-ideal")!.textContent = COPY.idealized;
document.querySelector("#copy-polymer")!.textContent = COPY.polymer;
document.querySelector("#copy-fixture")!.textContent = COPY.fixture;
document.querySelector("#copy-secant")!.textContent = COPY.secant;
document.querySelector("#copy-schematic")!.textContent = COPY.schematic;
document.querySelector("#copy-equal")!.textContent = COPY.equal;
document.querySelector("#copy-widens")!.textContent = COPY.widens;
document.querySelector("#copy-narrows")!.textContent = COPY.narrows;
document.querySelector("#copy-notevery")!.textContent = COPY.notEvery;
