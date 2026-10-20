import {
  type Lattice,
  type MechanicalState,
  auxeticLattice,
  conventionalLattice,
} from "../model/kinematics";
import { COPY, type SceneState } from "../model/timeline";

const BG = "#11151C";
const RIB = "#677482";
const GHOST = "rgba(231,225,213,0.35)";
const MINT = "#06D6A0";
const AMBER = "#FFB703";
const BONE = "#E7E1D5";
const METAL = "#8B95A1";

type Rect = { x: number; y: number; w: number; h: number };

function fit(state: MechanicalState, rect: Rect, pad = 0.16) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of state.nodes) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  minY = Math.min(minY, -0.9);
  maxY = Math.max(maxY, state.topY + 0.9);
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  const iw = rect.w * (1 - pad * 2);
  const ih = rect.h * (1 - pad * 2);
  const s = Math.min(iw / bw, ih / bh);
  const ox = rect.x + rect.w / 2 - ((minX + maxX) / 2) * s;
  const oy = rect.y + rect.h / 2 + ((minY + maxY) / 2) * s;
  return {
    p(x: number, y: number) {
      return { x: ox + x * s, y: oy - y * s };
    },
    s,
  };
}

function strokeEdges(
  ctx: CanvasRenderingContext2D,
  lattice: Lattice,
  state: MechanicalState,
  map: ReturnType<typeof fit>,
  color: string,
  width: number,
  dashed = false,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(dashed ? [6, 5] : []);
  ctx.beginPath();
  for (const edge of lattice.edges) {
    const a = map.p(state.nodes[edge.a].x, state.nodes[edge.a].y);
    const b = map.p(state.nodes[edge.b].x, state.nodes[edge.b].y);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  ctx.restore();
}

function arrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 6) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - Math.cos(ang - 0.45) * 8, y1 - Math.sin(ang - 0.45) * 8);
  ctx.lineTo(x1 - Math.cos(ang + 0.45) * 8, y1 - Math.sin(ang + 0.45) * 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function paintPair(
  ctx: CanvasRenderingContext2D,
  lattice: Lattice,
  theta: number,
  rect: Rect,
  mode: "out" | "in",
) {
  const rest = lattice.sample(lattice.spec.theta0);
  const now = lattice.sample(theta);
  const map = fit(now, rect, 0.18);
  strokeEdges(ctx, lattice, rest, map, GHOST, 1.25, true);
  strokeEdges(ctx, lattice, now, map, RIB, 2.4, false);
  const midY = (now.gauge.yB + now.gauge.yT) / 2;
  const left = map.p(now.gauge.xL, midY);
  const right = map.p(now.gauge.xR, midY);
  const reach = Math.min(28, rect.w * 0.08);
  if (mode === "out") {
    arrow(ctx, left.x, left.y, left.x - reach, left.y, MINT);
    arrow(ctx, right.x, right.y, right.x + reach, right.y, MINT);
  } else {
    arrow(ctx, left.x - reach, left.y, left.x, left.y, BONE);
    arrow(ctx, right.x + reach, right.y, right.x, right.y, BONE);
  }
}

export function paintComparison(canvas: HTMLCanvasElement, auxTheta: number, convTheta: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 8 || h < 8) return;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0d1218";
  ctx.fillRect(0, 0, w, h);
  const gap = 10;
  const half = (w - gap) / 2;
  paintPair(ctx, auxeticLattice, auxTheta, { x: 0, y: 0, w: half, h }, "out");
  paintPair(ctx, conventionalLattice, convTheta, { x: half + gap, y: 0, w: half, h }, "in");
  ctx.strokeStyle = "rgba(231,225,213,0.18)";
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(half + gap / 2, 12);
  ctx.lineTo(half + gap / 2, h - 12);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function paintStage(canvas: HTMLCanvasElement, state: SceneState) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const now = state.mechanical;
  const rest = auxeticLattice.sample(auxeticLattice.spec.theta0);
  const map = fit(now, { x: 0, y: 0, w, h: h * 0.92 }, 0.12);
  const railL = map.p(-Math.abs(now.gauge.xL) - 1.3, -0.82);
  const railR = map.p(Math.abs(now.gauge.xR) + 1.3, -0.82);
  ctx.strokeStyle = METAL;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(railL.x, railL.y);
  ctx.lineTo(railR.x, railR.y);
  ctx.stroke();
  const topYL = map.p(0, now.topY + 0.82);
  ctx.beginPath();
  ctx.moveTo(railL.x, topYL.y);
  ctx.lineTo(railR.x, topYL.y);
  ctx.stroke();
  if (state.ghost > 0.05) strokeEdges(ctx, auxeticLattice, rest, map, GHOST, 1.4, true);
  strokeEdges(ctx, auxeticLattice, now, map, RIB, 2.6, false);

  ctx.strokeStyle = BONE;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([]);
  const g0 = map.p(now.gauge.xL, now.gauge.yB);
  const g1 = map.p(now.gauge.xR, now.gauge.yT);
  ctx.strokeRect(Math.min(g0.x, g1.x), Math.min(g0.y, g1.y), Math.abs(g1.x - g0.x), Math.abs(g1.y - g0.y));

  if (state.amber > 0.05) {
    const base = map.p(0, now.topY + 1.05);
    const tip = map.p(0, now.topY + 1.05 + Math.max(0.35, state.gripDisplacement * 0.55));
    arrow(ctx, base.x, base.y, tip.x, tip.y, AMBER);
  }
  if (state.mint > 0.05) {
    const midY = (now.gauge.yB + now.gauge.yT) / 2;
    const left = map.p(now.gauge.xL, midY);
    const right = map.p(now.gauge.xR, midY);
    const reach = 18 + state.mint * 16;
    arrow(ctx, left.x, left.y, left.x - reach, left.y, MINT);
    arrow(ctx, right.x, right.y, right.x + reach, right.y, MINT);
  }

  ctx.fillStyle = BONE;
  ctx.font = "12px Space Grotesk, sans-serif";
  ctx.fillText(COPY.honeycomb, 16, 28);
  ctx.fillText("Orthographic fallback. Measurements still come from the kinematic model.", 16, h - 16);
}
