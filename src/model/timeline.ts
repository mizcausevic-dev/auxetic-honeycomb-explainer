import {
  AUXETIC_SPEC,
  CONVENTIONAL_SPEC,
  type MechanicalState,
  auxeticLattice,
  conventionalLattice,
  loadToTheta,
  thetaForAxialStrain,
} from "./kinematics";

export const DURATION = 34;
export const FPS = 30;
export const FRAME_COUNT = 1020;

export type ShotId = 1 | 2 | 3 | 4 | 5;

export type Shot = {
  id: ShotId;
  start: number;
  end: number;
  title: string;
  caption: string;
};

export const SHOTS: readonly Shot[] = [
  {
    id: 1,
    start: 0,
    end: 5,
    title: "Re-entrant coupon",
    caption: "Re-entrant honeycomb. Central gauge region. Y: loading. X: transverse.",
  },
  {
    id: 2,
    start: 5,
    end: 10,
    title: "Continuous mechanism",
    caption: "Continuous ribs. Compliant junctions. No mechanical pin joints.",
  },
  {
    id: 3,
    start: 10,
    end: 17,
    title: "Tensile loading",
    caption: "The top crosshead moves up. Oblique ribs rotate and bend. Illustrative flexure overlay.",
  },
  {
    id: 4,
    start: 17,
    end: 25,
    title: "Taller and wider",
    caption: "Negative effective Poisson's ratio. Axial strain > 0. Transverse strain > 0.",
  },
  {
    id: 5,
    start: 25,
    end: 34,
    title: "Unload and compare",
    caption: "Idealized elastic unloading, then a separate schematic comparison at equal axial strain.",
  },
];

export type CameraPose = {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  fov: number;
};

export type SceneState = {
  t: number;
  shot: Shot;
  lambda: number;
  theta: number;
  mechanical: MechanicalState;
  H: number;
  W: number;
  H0: number;
  W0: number;
  epsY: number;
  epsX: number;
  nu: number | null;
  gripDisplacement: number;
  camera: CameraPose;
  clipZ: number | null;
  ghost: number;
  flexure: number;
  gaugeOpacity: number;
  baselineOpacity: number;
  mint: number;
  amber: number;
  unloadCue: number;
  comparison: {
    opacity: number;
    eps: number;
    auxTheta: number;
    convTheta: number;
  };
  labels: {
    establish: number;
    mechanism: number;
    flexure: number;
    poisson: number;
    comparison: number;
  };
};

const PEAK_EPS = auxeticLattice.sample(AUXETIC_SPEC.theta1).epsY;

export function frameToTime(frame: number): number {
  return frame / FPS;
}

export function shotAt(t: number): Shot {
  const time = clamp(t, 0, DURATION);
  if (time >= DURATION) return SHOTS[4];
  for (const shot of SHOTS) {
    if (time >= shot.start && time < shot.end) return shot;
  }
  return SHOTS[4];
}

export function smoother(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function loadFactor(t: number): number {
  if (t < 10) return 0;
  if (t < 22.5) return smoother(10, 22.5, t);
  if (t < 25) return 1;
  if (t < 31.6) return 1 - smoother(25, 31.6, t);
  return 0;
}

export function comparisonOpacity(t: number): number {
  if (t < 27.2) return 0;
  if (t < 28.6) return smoother(27.2, 28.6, t);
  return 1;
}

export function comparisonEps(t: number): number {
  if (t < 28.4) return 0;
  if (t < 32.2) return smoother(28.4, 32.2, t) * PEAK_EPS;
  return PEAK_EPS;
}

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

type Key = CameraPose & { t: number };

const KEYS: Key[] = [
  { t: 0, x: 7.4, y: 5.6, z: 16.8, tx: 0, ty: 4.6, tz: 0, fov: 32 },
  { t: 5, x: 5.6, y: 5.7, z: 13.4, tx: 0.15, ty: 4.75, tz: 0, fov: 30 },
  { t: 7.4, x: 1.7, y: 5.55, z: 4.35, tx: 0.25, ty: 4.85, tz: 0, fov: 32 },
  { t: 10, x: 1.25, y: 5.35, z: 3.55, tx: 0.08, ty: 4.7, tz: 0, fov: 30 },
  { t: 13, x: 5.4, y: 6.5, z: 13.2, tx: 0, ty: 5.35, tz: 0, fov: 32 },
  { t: 17, x: 3.6, y: 6.9, z: 14.6, tx: 0, ty: 5.6, tz: 0, fov: 30 },
  { t: 19.6, x: 0.06, y: 6.15, z: 22.4, tx: 0, ty: 5.7, tz: 0, fov: 26 },
  { t: 25, x: 0.04, y: 6.25, z: 22.8, tx: 0, ty: 5.85, tz: 0, fov: 26 },
  { t: 33, x: -3.4, y: 6.15, z: 18.8, tx: -1.45, ty: 5.35, tz: 0, fov: 30 },
  { t: 34, x: -3.4, y: 6.15, z: 18.8, tx: -1.45, ty: 5.35, tz: 0, fov: 30 },
];

const REDUCED: Record<ShotId, Key> = {
  1: KEYS[0],
  2: KEYS[2],
  3: KEYS[4],
  4: KEYS[6],
  5: KEYS[8],
};

function poseFromKeys(t: number): CameraPose {
  let i = 0;
  while (i < KEYS.length - 2 && t >= KEYS[i + 1].t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const u = a.t === b.t ? 0 : smoother(a.t, b.t, t);
  return {
    x: lerp(a.x, b.x, u),
    y: lerp(a.y, b.y, u),
    z: lerp(a.z, b.z, u),
    tx: lerp(a.tx, b.tx, u),
    ty: lerp(a.ty, b.ty, u),
    tz: lerp(a.tz, b.tz, u),
    fov: lerp(a.fov, b.fov, u),
  };
}

export function sectionDepth(t: number): number | null {
  if (t < 6.1 || t >= 9.7) return null;
  if (t < 7.6) return lerp(0.28, 0.045, smoother(6.1, 7.6, t));
  if (t < 8.8) return 0.045;
  return lerp(0.045, 0.28, smoother(8.8, 9.7, t));
}

export const COPY = {
  honeycomb: "Re-entrant honeycomb",
  gauge: "Central gauge region",
  yLoad: "Y: loading",
  xTrans: "X: transverse",
  zThick: "Z: thickness",
  ribs: "Continuous ribs",
  junctions: "Compliant junctions",
  noPins: "No mechanical pin joints",
  flex: "Illustrative flexure overlay",
  poisson: "Negative effective Poisson's ratio",
  axial: "Axial strain > 0",
  transverse: "Transverse strain > 0",
  secant: "Illustrative effective secant ratio",
  amplified: "Deformation amplified for illustration.",
  idealized: "Idealized elastic response · illustrative kinematics.",
  polymer: "The polymer itself is not auxetic. The response belongs to this architecture.",
  fixture: "Illustrative test fixture. Laterally accommodating attachments. Bottom rail fixed in Y.",
  equal: "Equal axial strain",
  widens: "Auxetic: widens",
  narrows: "Conventional example: narrows",
  schematic: "Schematic comparison",
  notEvery: "One convex example. Not every conventional cell behaves this way.",
  returning: "Unloading",
} as const;

export function cameraAt(t: number, reducedMotion: boolean): CameraPose {
  if (reducedMotion) {
    const shot = shotAt(t);
    const k = REDUCED[shot.id];
    return { x: k.x, y: k.y, z: k.z, tx: k.tx, ty: k.ty, tz: k.tz, fov: k.fov };
  }
  return poseFromKeys(clamp(t, 0, DURATION));
}

function fadeWindow(t: number, a: number, b: number, c: number, d: number): number {
  const inn = t < b ? smoother(a, b, t) : 1;
  const out = t > c ? 1 - smoother(c, d, t) : 1;
  return clamp(inn * out, 0, 1);
}

export function sceneState(t: number, reducedMotion: boolean): SceneState {
  const time = clamp(t, 0, DURATION);
  const shot = shotAt(time);
  const lambda = loadFactor(time);
  const theta = loadToTheta(AUXETIC_SPEC, lambda);
  const mechanical = auxeticLattice.sample(theta);
  const eps = comparisonEps(time);
  return {
    t: time,
    shot,
    lambda,
    theta,
    mechanical,
    H: mechanical.H,
    W: mechanical.W,
    H0: mechanical.H0,
    W0: mechanical.W0,
    epsY: mechanical.epsY,
    epsX: mechanical.epsX,
    nu: mechanical.nu,
    gripDisplacement: mechanical.gripDisplacement,
    camera: cameraAt(time, reducedMotion),
    clipZ: sectionDepth(time),
    ghost: fadeWindow(time, 16.2, 17.4, 31.2, 32.4) * (0.35 + 0.65 * lambda),
    flexure: lambda < 0.04 ? 0 : Math.min(1, lambda * 1.15) * fadeWindow(time, 10, 11.2, 31.2, 32.2),
    gaugeOpacity: Math.max(fadeWindow(time, 0.4, 1.4, 4.2, 5.1), fadeWindow(time, 16.6, 17.8, 32.4, 33.2)),
    baselineOpacity: fadeWindow(time, 17.2, 18.4, 31.4, 32.4),
    mint: lambda < 0.03 ? 0 : Math.min(1, (mechanical.W - mechanical.W0) / (mechanical.W0 * 0.12)),
    amber: mechanical.gripDisplacement > 0.02 ? Math.min(1, mechanical.gripDisplacement / 0.4) : 0,
    unloadCue: time >= 25 && time < 31.6 ? 1 : 0,
    comparison: {
      opacity: comparisonOpacity(time),
      eps,
      auxTheta: thetaForAxialStrain(AUXETIC_SPEC, eps),
      convTheta: thetaForAxialStrain(CONVENTIONAL_SPEC, eps),
    },
    labels: {
      establish: fadeWindow(time, 0.3, 1.1, 4.3, 5),
      mechanism: fadeWindow(time, 5.2, 6.1, 9.3, 10),
      flexure: fadeWindow(time, 10.4, 11.3, 16.4, 17.2),
      poisson: fadeWindow(time, 17.2, 18.2, 24.4, 25.2),
      comparison: comparisonOpacity(time),
    },
  };
}

export const AUDIO_CUES = [
  { id: "cell", t: 5.05 },
  { id: "load", t: 10.05 },
  { id: "guides", t: 17.15 },
  { id: "hold", t: 22.55 },
  { id: "unload", t: 25.05 },
  { id: "compare", t: 28.35 },
] as const;

export function cuesBetween(t0: number, t1: number): (typeof AUDIO_CUES)[number][] {
  if (t1 <= t0) return [];
  return AUDIO_CUES.filter((cue) => cue.t >= t0 && cue.t < t1);
}

export { conventionalLattice, auxeticLattice, PEAK_EPS };
