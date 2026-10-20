/**
 * Illustrative kinematics for a re-entrant hexagonal honeycomb.
 *
 * This is a reduced-order geometric model, not finite-element analysis.
 * Oblique rib length `l` and vertical rib length `h` stay constant.
 * One shared angle θ (from the horizontal, negative for the re-entrant
 * architecture) sets every node. Axial and transverse gauge changes are
 * both consequences of that angle. They are not animated separately.
 *
 * θ increasing toward zero opens the re-entrant cells: the repeating pitch
 * grows in Y and in X. A conventional convex cell uses θ > 0; the same
 * axial extension then narrows the cell.
 */

export const DEG = Math.PI / 180;

export const RIB_HALF_WIDTH = 0.086;
export const RIB_HALF_DEPTH = 0.1;
export const JUNCTION_RADIUS = 0.186;
export const CAMBER_INCLINED = 0.042;
export const CAMBER_VERTICAL = 0;

export type LatticeSpec = {
  name: string;
  nC: number;
  nR: number;
  h: number;
  l: number;
  theta0: number;
  theta1: number;
  /** Gauge row span, inclusive, measured with the same local vertex. */
  gaugeJ0: number;
  gaugeJ1: number;
};

export const AUXETIC_SPEC: LatticeSpec = {
  name: "re-entrant",
  nC: 5,
  nR: 7,
  h: 1.8,
  l: 1,
  theta0: -38 * DEG,
  theta1: -14 * DEG,
  gaugeJ0: 2,
  gaugeJ1: 5,
};

export const CONVENTIONAL_SPEC: LatticeSpec = {
  name: "conventional-convex",
  nC: 4,
  nR: 5,
  h: 1.8,
  l: 1,
  theta0: 15 * DEG,
  theta1: 65.3 * DEG,
  gaugeJ0: 1,
  gaugeJ1: 3,
};

export type NodeId = number;

export type NodeRec = {
  id: NodeId;
  i: number;
  j: number;
  k: number;
  aliases: { i: number; j: number; k: number }[];
};

export type EdgeRec = {
  id: number;
  a: NodeId;
  b: NodeId;
  kind: "vertical" | "inclined";
  length0: number;
  bowSign: number;
};

export type Vec2 = { x: number; y: number };

export type MechanicalState = {
  theta: number;
  nodes: Vec2[];
  H: number;
  W: number;
  H0: number;
  W0: number;
  epsY: number;
  epsX: number;
  /** Null near zero axial strain, where the secant ratio is undefined. */
  nu: number | null;
  bottomY: number;
  topY: number;
  gripDisplacement: number;
  padsBottom: Vec2[];
  padsTop: Vec2[];
  gauge: { xL: number; xR: number; yB: number; yT: number };
};

export type Lattice = {
  spec: LatticeSpec;
  nodes: NodeRec[];
  edges: EdgeRec[];
  cellNodes: number[][][];
  bottomIds: NodeId[];
  topIds: NodeId[];
  gaugeBottomIds: NodeId[];
  gaugeTopIds: NodeId[];
  gaugeLeftIds: NodeId[];
  gaugeRightIds: NodeId[];
  H0: number;
  W0: number;
  restTopY: number;
  sample: (theta: number) => MechanicalState;
};

const NU_EPS = 1e-3;

function localVert(theta: number, k: number, l: number, h: number): Vec2 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const table: Vec2[] = [
    { x: 0, y: 0 },
    { x: l * c, y: l * s },
    { x: l * c, y: l * s + h },
    { x: 0, y: 2 * l * s + h },
    { x: -l * c, y: l * s + h },
    { x: -l * c, y: l * s },
  ];
  return table[k];
}

function cellOrigin(spec: LatticeSpec, i: number, j: number, theta: number): Vec2 {
  const dx = 2 * spec.l * Math.cos(theta);
  const dy = spec.h + spec.l * Math.sin(theta);
  const iCenter = (spec.nC - 1) / 2;
  const phase = (j % 2) * (dx / 2) - dx / 4;
  return {
    x: (i - iCenter) * dx + phase,
    y: j * dy,
  };
}

function vertexPosition(spec: LatticeSpec, i: number, j: number, k: number, theta: number): Vec2 {
  const o = cellOrigin(spec, i, j, theta);
  const v = localVert(theta, k, spec.l, spec.h);
  return { x: o.x + v.x, y: o.y + v.y };
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function average(ids: NodeId[], nodes: Vec2[], axis: "x" | "y"): number {
  let s = 0;
  for (const id of ids) s += nodes[id][axis];
  return s / ids.length;
}

export function createLattice(spec: LatticeSpec): Lattice {
  const ref = -20 * DEG;
  const keyOf = (i: number, j: number, k: number) => {
    const p = vertexPosition(spec, i, j, k, ref);
    return `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
  };

  const buckets = new Map<string, NodeId>();
  const nodes: NodeRec[] = [];
  const cellNodes: number[][][] = [];

  for (let j = 0; j < spec.nR; j++) {
    cellNodes[j] = [];
    for (let i = 0; i < spec.nC; i++) {
      const ids: number[] = [];
      for (let k = 0; k < 6; k++) {
        const key = keyOf(i, j, k);
        let id = buckets.get(key);
        if (id === undefined) {
          id = nodes.length;
          buckets.set(key, id);
          nodes.push({ id, i, j, k, aliases: [] });
        }
        nodes[id].aliases.push({ i, j, k });
        ids.push(id);
      }
      cellNodes[j][i] = ids;
    }
  }

  const edgeMap = new Map<string, EdgeRec>();
  for (let j = 0; j < spec.nR; j++) {
    for (let i = 0; i < spec.nC; i++) {
      const ids = cellNodes[j][i];
      for (let k = 0; k < 6; k++) {
        const a = ids[k];
        const b = ids[(k + 1) % 6];
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const key = `${lo}-${hi}`;
        if (edgeMap.has(key)) continue;
        const pa = vertexPosition(spec, nodes[a].i, nodes[a].j, nodes[a].k, spec.theta0);
        const pb = vertexPosition(spec, nodes[b].i, nodes[b].j, nodes[b].k, spec.theta0);
        const length0 = dist(pa, pb);
        const kind = Math.abs(length0 - spec.h) < 1e-6 ? "vertical" : "inclined";
        edgeMap.set(key, {
          id: edgeMap.size,
          a: lo,
          b: hi,
          kind,
          length0,
          bowSign: 0,
        });
      }
    }
  }
  const edges = [...edgeMap.values()];

  const bottomIds = uniqueBoundary(cellNodes, spec, "bottom");
  const topIds = uniqueBoundary(cellNodes, spec, "top");
  const gaugeBottomIds = uniqueRowVertex(cellNodes, spec, spec.gaugeJ0, 0);
  const gaugeTopIds = uniqueRowVertex(cellNodes, spec, spec.gaugeJ1, 0);
  const gaugeLeftIds = uniqueColumnVertex(cellNodes, 0, 4, spec.gaugeJ0, spec.gaugeJ1);
  const gaugeRightIds = uniqueColumnVertex(cellNodes, spec.nC - 1, 2, spec.gaugeJ0, spec.gaugeJ1);

  const lattice: Lattice = {
    spec,
    nodes,
    edges,
    cellNodes,
    bottomIds,
    topIds,
    gaugeBottomIds,
    gaugeTopIds,
    gaugeLeftIds,
    gaugeRightIds,
    H0: 0,
    W0: 0,
    restTopY: 0,
    sample: () => {
      throw new Error("sample not bound");
    },
  };

  const rest = place(lattice, spec.theta0);
  lattice.H0 = gaugeHeight(lattice, rest);
  lattice.W0 = gaugeWidth(lattice, rest);
  lattice.restTopY = average(topIds, rest, "y");

  for (const edge of edges) {
    const a0 = rest[edge.a];
    const b0 = rest[edge.b];
    const open = place(lattice, spec.theta1);
    const a1 = open[edge.a];
    const b1 = open[edge.b];
    const rx = b0.x - a0.x;
    const ry = b0.y - a0.y;
    const ox = b1.x - a1.x;
    const oy = b1.y - a1.y;
    const spin = rx * oy - ry * ox;
    edge.bowSign = Math.abs(spin) < 1e-8 ? 0 : Math.sign(spin);
  }

  lattice.sample = (theta: number) => sampleAt(lattice, theta);
  return lattice;
}

function uniqueBoundary(
  cellNodes: number[][][],
  spec: LatticeSpec,
  which: "bottom" | "top",
): NodeId[] {
  const j = which === "bottom" ? 0 : spec.nR - 1;
  const ks = which === "bottom" ? [1, 5] : [2, 4];
  const ids = new Set<number>();
  for (let i = 0; i < spec.nC; i++) {
    for (const k of ks) ids.add(cellNodes[j][i][k]);
  }
  return [...ids];
}

function uniqueRowVertex(cellNodes: number[][][], spec: LatticeSpec, j: number, k: number): NodeId[] {
  const ids = new Set<number>();
  for (let i = 0; i < spec.nC; i++) ids.add(cellNodes[j][i][k]);
  return [...ids];
}

function uniqueColumnVertex(
  cellNodes: number[][][],
  i: number,
  k: number,
  j0: number,
  j1: number,
): NodeId[] {
  const ids = new Set<number>();
  for (let j = j0; j <= j1; j++) ids.add(cellNodes[j][i][k]);
  return [...ids];
}

/** Unanchored positions from the canonical alias, then fix the bottom rail at Y = 0 and keep X centered. */
export function place(lattice: Lattice, theta: number): Vec2[] {
  const spec = lattice.spec;
  const raw = lattice.nodes.map((node) => vertexPosition(spec, node.i, node.j, node.k, theta));
  let yBottom = 0;
  for (const id of lattice.bottomIds) yBottom += raw[id].y;
  yBottom /= lattice.bottomIds.length;
  return raw.map((p) => ({ x: p.x, y: p.y - yBottom }));
}

function gaugeHeight(lattice: Lattice, nodes: Vec2[]): number {
  return average(lattice.gaugeTopIds, nodes, "y") - average(lattice.gaugeBottomIds, nodes, "y");
}

function gaugeWidth(lattice: Lattice, nodes: Vec2[]): number {
  return average(lattice.gaugeRightIds, nodes, "x") - average(lattice.gaugeLeftIds, nodes, "x");
}

function sampleAt(lattice: Lattice, theta: number): MechanicalState {
  const nodes = place(lattice, theta);
  const H = gaugeHeight(lattice, nodes);
  const W = gaugeWidth(lattice, nodes);
  const epsY = (H - lattice.H0) / lattice.H0;
  const epsX = (W - lattice.W0) / lattice.W0;
  const nu = Math.abs(epsY) < NU_EPS ? null : -epsX / epsY;
  const bottomY = average(lattice.bottomIds, nodes, "y");
  const topY = average(lattice.topIds, nodes, "y");
  return {
    theta,
    nodes,
    H,
    W,
    H0: lattice.H0,
    W0: lattice.W0,
    epsY,
    epsX,
    nu,
    bottomY,
    topY,
    gripDisplacement: topY - lattice.restTopY,
    padsBottom: lattice.bottomIds.map((id) => ({ ...nodes[id] })),
    padsTop: lattice.topIds.map((id) => ({ ...nodes[id] })),
    gauge: {
      xL: average(lattice.gaugeLeftIds, nodes, "x"),
      xR: average(lattice.gaugeRightIds, nodes, "x"),
      yB: average(lattice.gaugeBottomIds, nodes, "y"),
      yT: average(lattice.gaugeTopIds, nodes, "y"),
    },
  };
}

export function thetaForAxialStrain(spec: LatticeSpec, epsY: number): number {
  const dy0 = spec.h + spec.l * Math.sin(spec.theta0);
  const dy = dy0 * (1 + epsY);
  const s = (dy - spec.h) / spec.l;
  if (s < -1 || s > 1) {
    throw new Error(`Axial strain ${epsY} is outside the kinematic range for ${spec.name}.`);
  }
  return Math.asin(s);
}

export function loadToTheta(spec: LatticeSpec, lambda: number): number {
  const t = clamp01(lambda);
  return spec.theta0 + (spec.theta1 - spec.theta0) * t;
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export type CurvePoint = { x: number; y: number; z: number };

/** Smooth centerline. Camber is a fraction of chord length, perpendicular in XY. */
export function sampleCenterline(a: Vec2, b: Vec2, camber: number, segments = 10): CurvePoint[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const cx = (a.x + b.x) / 2 + px * camber;
  const cy = (a.y + b.y) / 2 + py * camber;
  const pts: CurvePoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    pts.push({
      x: u * u * a.x + 2 * u * t * cx + t * t * b.x,
      y: u * u * a.y + 2 * u * t * cy + t * t * b.y,
      z: 0,
    });
  }
  return pts;
}

export function centerlineLength(pts: CurvePoint[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
  }
  return s;
}

export function edgeCamber(edge: EdgeRec, lambda: number): number {
  const amp = edge.kind === "inclined" ? CAMBER_INCLINED : CAMBER_VERTICAL;
  // Fixed per-rib variation so the flexure overlay is not a uniform strain paint.
  const variation = edge.kind === "inclined" ? 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(edge.id * 1.7)) : 1;
  return edge.length0 * amp * clamp01(lambda) * edge.bowSign * variation;
}

export function segmentCrossings(lattice: Lattice, theta: number): number {
  const nodes = place(lattice, theta);
  const segs = lattice.edges.map((e) => [nodes[e.a], nodes[e.b]] as const);
  let hits = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const [a, b] = segs[i];
      const [c, d] = segs[j];
      if (sharesEndpoint(a, b, c, d)) continue;
      if (properCrossing(a, b, c, d)) hits++;
    }
  }
  return hits;
}

function sharesEndpoint(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  return a === c || a === d || b === c || b === d;
}

function properCrossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const sgn = (v: number) => (v < -1e-8 ? -1 : v > 1e-8 ? 1 : 0);
  const d1 = sgn(cross(a, b, c));
  const d2 = sgn(cross(a, b, d));
  const d3 = sgn(cross(c, d, a));
  const d4 = sgn(cross(c, d, b));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function minNonadjacentDistance(lattice: Lattice, theta: number): number {
  const nodes = place(lattice, theta);
  const adj = new Set(lattice.edges.map((e) => `${e.a}-${e.b}`));
  let minD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const key = `${i}-${j}`;
      if (adj.has(key)) continue;
      const d = dist(nodes[i], nodes[j]);
      if (d < minD) minD = d;
    }
  }
  return minD;
}

export function minSegmentDistance(lattice: Lattice, theta: number): number {
  const nodes = place(lattice, theta);
  let minD = Infinity;
  const edges = lattice.edges;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i];
      const b = edges[j];
      if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) continue;
      const d = segmentDistance(nodes[a.a], nodes[a.b], nodes[b.a], nodes[b.b]);
      if (d < minD) minD = d;
    }
  }
  return minD;
}

function segmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  // Sampled distance is enough for a gross-clearance check on short ribs.
  let minD = Infinity;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      const q = { x: c.x + (d.x - c.x) * u, y: c.y + (d.y - c.y) * u };
      const dd = dist(p, q);
      if (dd < minD) minD = dd;
    }
  }
  return minD;
}

export function graphStats(lattice: Lattice): {
  components: number;
  maxDegree: number;
  minDegree: number;
  interiorMinDegree: number;
} {
  const n = lattice.nodes.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const e of lattice.edges) {
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  }
  const seen = new Array(n).fill(false);
  let components = 0;
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    components++;
    const stack = [i];
    seen[i] = true;
    while (stack.length) {
      const v = stack.pop()!;
      for (const u of adj[v]) {
        if (!seen[u]) {
          seen[u] = true;
          stack.push(u);
        }
      }
    }
  }
  let maxDegree = 0;
  let minDegree = Infinity;
  let interiorMinDegree = Infinity;
  const boundary = new Set<number>();
  const xs = place(lattice, lattice.spec.theta0).map((p) => p.x);
  const ys = place(lattice, lattice.spec.theta0).map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  for (let i = 0; i < n; i++) {
    if (Math.abs(xs[i] - minX) < 1e-6 || Math.abs(xs[i] - maxX) < 1e-6 || Math.abs(ys[i] - minY) < 1e-6 || Math.abs(ys[i] - maxY) < 1e-6) {
      boundary.add(i);
    }
    maxDegree = Math.max(maxDegree, adj[i].length);
    minDegree = Math.min(minDegree, adj[i].length);
  }
  for (let i = 0; i < n; i++) {
    if (!boundary.has(i)) interiorMinDegree = Math.min(interiorMinDegree, adj[i].length);
  }
  return { components, maxDegree, minDegree, interiorMinDegree };
}

export function aliasDisagreement(lattice: Lattice, theta: number): number {
  let maxD = 0;
  for (const node of lattice.nodes) {
    const canonical = vertexPosition(lattice.spec, node.i, node.j, node.k, theta);
    for (const alias of node.aliases) {
      const p = vertexPosition(lattice.spec, alias.i, alias.j, alias.k, theta);
      maxD = Math.max(maxD, dist(canonical, p));
    }
  }
  return maxD;
}

export function isReentrantCell(spec: LatticeSpec, theta: number): boolean {
  // Reflex corners exist when the walk changes turn direction.
  const v = [0, 1, 2, 3, 4, 5].map((k) => {
    const p = localVert(theta, k, spec.l, spec.h);
    return p;
  });
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < 6; i++) {
    const prev = v[(i + 5) % 6];
    const curr = v[i];
    const next = v[(i + 1) % 6];
    const cr = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
    if (cr > 1e-8) pos++;
    else if (cr < -1e-8) neg++;
  }
  return pos > 0 && neg > 0;
}

export const auxeticLattice = createLattice(AUXETIC_SPEC);
export const conventionalLattice = createLattice(CONVENTIONAL_SPEC);
