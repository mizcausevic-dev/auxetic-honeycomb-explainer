import { describe, expect, it } from "vitest";
import {
  AUXETIC_SPEC,
  CAMBER_INCLINED,
  CONVENTIONAL_SPEC,
  JUNCTION_RADIUS,
  RIB_HALF_DEPTH,
  RIB_HALF_WIDTH,
  aliasDisagreement,
  auxeticLattice,
  centerlineLength,
  conventionalLattice,
  edgeCamber,
  graphStats,
  isReentrantCell,
  loadToTheta,
  minSegmentDistance,
  sampleCenterline,
  segmentCrossings,
  thetaForAxialStrain,
} from "../src/model/kinematics";
import { DURATION, FPS, comparisonEps, frameToTime, loadFactor, sceneState, shotAt } from "../src/model/timeline";

const aux = auxeticLattice;
const conv = conventionalLattice;

describe("topology", () => {
  it("keeps one connected welded graph with honeycomb degree", () => {
    const stats = graphStats(aux);
    expect(stats.components).toBe(1);
    expect(stats.maxDegree).toBe(3);
    expect(stats.minDegree).toBe(2);
    const degree = new Map<number, number>();
    for (const edge of aux.edges) {
      degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1);
      degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1);
    }
    for (const value of degree.values()) {
      expect(value === 2 || value === 3).toBe(true);
    }
    const center = aux.cellNodes[3][2];
    for (const id of center) expect(degree.get(id)).toBe(3);
    expect(aux.edges.length).toBeGreaterThan(aux.nodes.length);
  });

  it("keeps shared aliases coincident at rest, mid, and open angles", () => {
    for (const theta of [AUXETIC_SPEC.theta0, -26 * (Math.PI / 180), AUXETIC_SPEC.theta1, 15 * (Math.PI / 180), 50 * (Math.PI / 180)]) {
      expect(aliasDisagreement(aux, theta)).toBeLessThan(1e-8);
      expect(aliasDisagreement(conv, theta)).toBeLessThan(1e-8);
    }
  });

  it("preserves chord lengths and does not stretch vertical ribs as the cell opens", () => {
    const rest = aux.sample(AUXETIC_SPEC.theta0);
    const open = aux.sample(AUXETIC_SPEC.theta1);
    for (const edge of aux.edges) {
      const lr = Math.hypot(rest.nodes[edge.b].x - rest.nodes[edge.a].x, rest.nodes[edge.b].y - rest.nodes[edge.a].y);
      const lo = Math.hypot(open.nodes[edge.b].x - open.nodes[edge.a].x, open.nodes[edge.b].y - open.nodes[edge.a].y);
      expect(Math.abs(lr - edge.length0) / edge.length0).toBeLessThan(1e-9);
      expect(Math.abs(lo - edge.length0) / edge.length0).toBeLessThan(1e-9);
      if (edge.kind === "vertical") {
        expect(Math.abs(rest.nodes[edge.a].x - rest.nodes[edge.b].x)).toBeLessThan(1e-8);
        expect(Math.abs(open.nodes[edge.a].x - open.nodes[edge.b].x)).toBeLessThan(1e-8);
      }
    }
    const inclined = aux.edges.find((e) => e.kind === "inclined");
    expect(inclined).toBeTruthy();
    if (inclined) {
      const a0 = rest.nodes[inclined.a];
      const b0 = rest.nodes[inclined.b];
      const a1 = open.nodes[inclined.a];
      const b1 = open.nodes[inclined.b];
      const ang0 = Math.atan2(b0.y - a0.y, b0.x - a0.x);
      const ang1 = Math.atan2(b1.y - a1.y, b1.x - a1.x);
      expect(Math.abs(ang1 - ang0)).toBeGreaterThan(5 * (Math.PI / 180));
    }
  });

  it("keeps curved centerlines within 2.5% of the chord", () => {
    const open = aux.sample(AUXETIC_SPEC.theta1);
    let worst = 1;
    for (const edge of aux.edges) {
      const camber = edgeCamber(edge, 1);
      const pts = sampleCenterline(open.nodes[edge.a], open.nodes[edge.b], camber, 16);
      const arc = centerlineLength(pts);
      const ratio = arc / edge.length0;
      if (ratio > worst) worst = ratio;
      expect(ratio).toBeGreaterThan(0.999);
      expect(ratio).toBeLessThan(1.025);
    }
    expect(CAMBER_INCLINED).toBeGreaterThan(0);
    expect(worst).toBeGreaterThan(1);
  });
});

describe("auxetic response", () => {
  it("widens and lengthens together, with a negative secant ratio", () => {
    const rest = aux.sample(AUXETIC_SPEC.theta0);
    const open = aux.sample(AUXETIC_SPEC.theta1);
    expect(rest.epsY).toBeCloseTo(0, 8);
    expect(rest.epsX).toBeCloseTo(0, 8);
    expect(rest.nu).toBeNull();
    expect(open.H).toBeGreaterThan(rest.H0);
    expect(open.W).toBeGreaterThan(rest.W0);
    expect(open.epsY).toBeGreaterThan(0.2);
    expect(open.epsX).toBeGreaterThan(0.15);
    expect(open.nu).not.toBeNull();
    expect(open.nu!).toBeLessThan(0);
    expect(open.nu!).toBeCloseTo(-open.epsX / open.epsY, 10);
  });

  it("stays re-entrant, clear of self-contact, and returns exactly", () => {
    expect(isReentrantCell(AUXETIC_SPEC, AUXETIC_SPEC.theta0)).toBe(true);
    expect(isReentrantCell(AUXETIC_SPEC, AUXETIC_SPEC.theta1)).toBe(true);
    expect(AUXETIC_SPEC.theta0).toBeLessThan(0);
    expect(AUXETIC_SPEC.theta1).toBeLessThan(0);
    for (const lambda of [0, 0.25, 0.5, 0.75, 1]) {
      const theta = loadToTheta(AUXETIC_SPEC, lambda);
      expect(segmentCrossings(aux, theta)).toBe(0);
      const clearance = minSegmentDistance(aux, theta);
      expect(clearance).toBeGreaterThan(2 * RIB_HALF_WIDTH);
      expect(clearance).toBeGreaterThan(2 * JUNCTION_RADIUS * 0.92);
    }
    expect(RIB_HALF_WIDTH).toBeGreaterThan(0);
    expect(RIB_HALF_DEPTH).toBeGreaterThan(0);
    const back = aux.sample(AUXETIC_SPEC.theta0);
    const again = aux.sample(AUXETIC_SPEC.theta0);
    expect(back.nodes).toEqual(again.nodes);
    expect(back.gripDisplacement).toBeCloseTo(0, 8);
  });

  it("holds the bottom attachments and raises only the top crosshead", () => {
    const rest = aux.sample(AUXETIC_SPEC.theta0);
    const mid = aux.sample(loadToTheta(AUXETIC_SPEC, 0.5));
    const open = aux.sample(AUXETIC_SPEC.theta1);
    expect(rest.bottomY).toBeCloseTo(0, 8);
    expect(mid.bottomY).toBeCloseTo(0, 8);
    expect(open.bottomY).toBeCloseTo(0, 8);
    expect(open.topY).toBeGreaterThan(rest.topY);
    expect(open.gripDisplacement).toBeGreaterThan(0.5);
    expect(mid.gripDisplacement).toBeGreaterThan(0);
    expect(mid.gripDisplacement).toBeLessThan(open.gripDisplacement);
    for (const pad of open.padsBottom) expect(pad.y).toBeCloseTo(0, 8);
  });

  it("is deterministic for repeated samples", () => {
    const a = aux.sample(loadToTheta(AUXETIC_SPEC, 0.37));
    const b = aux.sample(loadToTheta(AUXETIC_SPEC, 0.37));
    expect(a).toEqual(b);
  });
});

describe("conventional comparison", () => {
  it("narrows at the same axial strain and stays convex", () => {
    const open = aux.sample(AUXETIC_SPEC.theta1);
    expect(isReentrantCell(CONVENTIONAL_SPEC, CONVENTIONAL_SPEC.theta0)).toBe(false);
    const theta = thetaForAxialStrain(CONVENTIONAL_SPEC, open.epsY);
    const state = conv.sample(theta);
    expect(state.epsY).toBeCloseTo(open.epsY, 3);
    expect(state.epsX).toBeLessThan(-0.2);
    expect(state.nu).not.toBeNull();
    expect(state.nu!).toBeGreaterThan(0);
    expect(segmentCrossings(conv, CONVENTIONAL_SPEC.theta0)).toBe(0);
    expect(segmentCrossings(conv, theta)).toBe(0);
  });
});

describe("timeline", () => {
  it("covers exactly 34 seconds and 1020 frames", () => {
    expect(DURATION).toBe(34);
    expect(FPS).toBe(30);
    expect(frameToTime(0)).toBe(0);
    expect(frameToTime(1019)).toBeCloseTo(1019 / 30, 10);
    expect(shotAt(0).id).toBe(1);
    expect(shotAt(4.999).id).toBe(1);
    expect(shotAt(5).id).toBe(2);
    expect(shotAt(9.999).id).toBe(2);
    expect(shotAt(10).id).toBe(3);
    expect(shotAt(16.999).id).toBe(3);
    expect(shotAt(17).id).toBe(4);
    expect(shotAt(24.999).id).toBe(4);
    expect(shotAt(25).id).toBe(5);
    expect(shotAt(33.999).id).toBe(5);
    expect(shotAt(34).id).toBe(5);
    for (let f = 0; f < 1020; f++) {
      const t = frameToTime(f);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(34);
    }
  });

  it("loads, holds, and unloads from the master clock", () => {
    expect(loadFactor(0)).toBe(0);
    expect(loadFactor(9.999)).toBe(0);
    expect(loadFactor(22.5)).toBeCloseTo(1, 8);
    expect(loadFactor(24.9)).toBeCloseTo(1, 8);
    expect(loadFactor(31.6)).toBeCloseTo(0, 8);
    expect(loadFactor(34)).toBe(0);
    expect(loadFactor(17)).toBeGreaterThan(0.4);
    expect(loadFactor(17)).toBeLessThan(0.75);
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const v = loadFactor(10 + (12.5 * i) / 20);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    prev = 1;
    for (let i = 1; i <= 20; i++) {
      const v = loadFactor(25 + (6.6 * i) / 20);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });

  it("derives strains from the lattice and restores the specimen by 31.6 s", () => {
    const rest = sceneState(0, false);
    const mid = sceneState(17, false);
    const peak = sceneState(23, false);
    const done = sceneState(32, false);
    const end = sceneState(34, false);
    expect(rest.epsY).toBeCloseTo(0, 8);
    expect(rest.nu).toBeNull();
    expect(mid.epsY).toBeGreaterThan(0);
    expect(mid.epsX).toBeGreaterThan(0);
    expect(mid.nu).toBeLessThan(0);
    expect(peak.lambda).toBe(1);
    expect(peak.gripDisplacement).toBeGreaterThan(rest.gripDisplacement);
    expect(done.lambda).toBe(0);
    expect(done.gripDisplacement).toBeCloseTo(0, 6);
    expect(done.epsY).toBeCloseTo(0, 6);
    expect(end.camera.x).toBeCloseTo(sceneState(33, false).camera.x, 6);
    expect(end.comparison.opacity).toBe(1);
    expect(end.comparison.eps).toBeGreaterThan(0.2);
    expect(sceneState(2, false).shot.caption).toContain("Re-entrant honeycomb");
    expect(sceneState(2, false).shot.caption).toContain("Central gauge region");
    expect(sceneState(2, false).shot.caption).toContain("Y: loading");
    expect(sceneState(2, false).shot.caption).toContain("X: transverse");
    expect(sceneState(7.5, false).shot.caption).toContain("No mechanical pin joints");
    expect(sceneState(13, false).shot.caption).toContain("Illustrative flexure overlay");
    expect(sceneState(21, false).shot.caption).toContain("Negative effective Poisson's ratio");
    expect(sceneState(21, false).shot.caption).toContain("Axial strain > 0");
    expect(sceneState(21, false).shot.caption).toContain("Transverse strain > 0");
    expect(sceneState(21, false).nu).toBeLessThan(0);
    expect(sceneState(0.2, false).nu).toBeNull();
    expect(comparisonEps(32.4)).toBeCloseTo(aux.sample(AUXETIC_SPEC.theta1).epsY, 5);
    expect(sceneState(12.25, false)).toEqual(sceneState(12.25, false));
  });
});
