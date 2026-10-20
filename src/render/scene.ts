import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import {
  AUXETIC_SPEC,
  JUNCTION_RADIUS,
  RIB_HALF_DEPTH,
  RIB_HALF_WIDTH,
  type EdgeRec,
  type Vec2,
  auxeticLattice,
  edgeCamber,
  sampleCenterline,
} from "../model/kinematics";
import { COPY, type SceneState } from "../model/timeline";

const PROFILE = 12;
const SEGMENTS = 10;
const BG = 0x11151c;

type Ribbon = {
  geo: THREE.BufferGeometry;
  positions: Float32Array;
  normals: Float32Array;
  mesh: THREE.Mesh;
  edges: EdgeRec[];
  hw: number;
  hd: number;
};

type ProfilePoint = { u: number; v: number; nu: number; nv: number };

const profileCache = new Map<string, ProfilePoint[]>();

function profile(hw: number, hd: number): ProfilePoint[] {
  const key = `${hw}:${hd}`;
  const hit = profileCache.get(key);
  if (hit) return hit;
  const pts: ProfilePoint[] = [];
  const power = 0.62;
  for (let i = 0; i < PROFILE; i++) {
    const a = (i / PROFILE) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const u = Math.sign(c) * hw * Math.abs(c) ** power;
    const v = Math.sign(s) * hd * Math.abs(s) ** power;
    const nu = u / (hw * hw);
    const nv = v / (hd * hd);
    const nl = Math.hypot(nu, nv) || 1;
    pts.push({ u, v, nu: nu / nl, nv: nv / nl });
  }
  profileCache.set(key, pts);
  return pts;
}

function makeRibbon(edges: EdgeRec[], hw: number, hd: number, material: THREE.Material): Ribbon {
  const rings = SEGMENTS + 1;
  const vCount = edges.length * rings * PROFILE;
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const index: number[] = [];
  for (let e = 0; e < edges.length; e++) {
    for (let s = 0; s < SEGMENTS; s++) {
      for (let p = 0; p < PROFILE; p++) {
        const p2 = (p + 1) % PROFILE;
        const base = e * rings * PROFILE;
        const a = base + s * PROFILE + p;
        const b = base + s * PROFILE + p2;
        const c = base + (s + 1) * PROFILE + p;
        const d = base + (s + 1) * PROFILE + p2;
        index.push(a, c, b, b, c, d);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setIndex(index);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 6, 0), 16);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return { geo, positions, normals, mesh, edges, hw, hd };
}

function updateRibbon(ribbon: Ribbon, nodes: Vec2[], lambda: number) {
  const rings = SEGMENTS + 1;
  const shape = profile(ribbon.hw, ribbon.hd);
  const { positions, normals, edges } = ribbon;
  for (let e = 0; e < edges.length; e++) {
    const edge = edges[e];
    const camber = edgeCamber(edge, lambda);
    const pts = sampleCenterline(nodes[edge.a], nodes[edge.b], camber, SEGMENTS);
    for (let s = 0; s < rings; s++) {
      const prev = pts[Math.max(0, s - 1)];
      const next = pts[Math.min(rings - 1, s + 1)];
      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      let tz = next.z - prev.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      let nx = -ty;
      let ny = tx;
      let nz = 0;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const bx = ty * nz - tz * ny;
      const by = tz * nx - tx * nz;
      const bz = tx * ny - ty * nx;
      const pnt = pts[s];
      for (let p = 0; p < PROFILE; p++) {
        const pr = shape[p];
        const idx = (e * rings * PROFILE + s * PROFILE + p) * 3;
        positions[idx] = pnt.x + nx * pr.u + bx * pr.v;
        positions[idx + 1] = pnt.y + ny * pr.u + by * pr.v;
        positions[idx + 2] = pnt.z + nz * pr.u + bz * pr.v;
        const nnx = nx * pr.nu + bx * pr.nv;
        const nny = ny * pr.nu + by * pr.nv;
        const nnz = nz * pr.nu + bz * pr.nv;
        const nnl = Math.hypot(nnx, nny, nnz) || 1;
        normals[idx] = nnx / nnl;
        normals[idx + 1] = nny / nnl;
        normals[idx + 2] = nnz / nnl;
      }
    }
  }
  ribbon.geo.attributes.position.needsUpdate = true;
  ribbon.geo.attributes.normal.needsUpdate = true;
}

function makeArrow(color: number): THREE.Group {
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.85,
    roughness: 0.35,
    metalness: 0.05,
  });
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1, 14), mat);
  shaft.position.y = 0.5;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.22, 16), mat);
  head.position.y = 1.1;
  group.add(shaft, head);
  return group;
}

function pointArrow(arrow: THREE.Group, origin: THREE.Vector3, dir: THREE.Vector3, length: number) {
  if (length < 0.05) {
    arrow.visible = false;
    return;
  }
  arrow.visible = true;
  const n = dir.clone().normalize();
  arrow.position.copy(origin);
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  arrow.scale.set(1, length, 1);
}

function setPolyline(line: THREE.Line, points: THREE.Vector3[]) {
  const arr = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    arr[i * 3] = p.x;
    arr[i * 3 + 1] = p.y;
    arr[i * 3 + 2] = p.z;
  });
  line.geometry.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  line.computeLineDistances();
}

export type View = {
  render: (state: SceneState) => void;
  resize: () => void;
  dispose: () => void;
};

export function createView(canvas: HTMLCanvasElement, lite: boolean): View {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(BG, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !lite;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.08, 160);

  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0).texture;
    pmrem.dispose();
  } catch {
    // Key and fill lights still describe the satin surface if the procedural room fails.
  }

  const key = new THREE.DirectionalLight(0xfff6ea, 2.5);
  key.position.set(5.5, 11, 8);
  key.castShadow = !lite;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 40;
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 16;
  key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.0006;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb9c9d6, 0.62);
  fill.position.set(-7, 4, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x7fd7dc, 0.38);
  rim.position.set(-2, 6, -8);
  scene.add(rim);
  scene.add(new THREE.AmbientLight(0x1c2633, 0.7));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 48),
    new THREE.MeshStandardMaterial({ color: 0x171d26, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.28;
  ground.receiveShadow = true;
  scene.add(ground);

  const polymer = new THREE.MeshPhysicalMaterial({
    color: 0x677482,
    metalness: 0.22,
    roughness: 0.42,
    clearcoat: 0.28,
    clearcoatRoughness: 0.45,
    side: THREE.DoubleSide,
  });
  const ghostMat = new THREE.MeshPhysicalMaterial({
    color: 0xaeb6c0,
    metalness: 0,
    roughness: 0.85,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const flexMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  const solid = makeRibbon(auxeticLattice.edges, RIB_HALF_WIDTH, RIB_HALF_DEPTH, polymer);
  const ghost = makeRibbon(auxeticLattice.edges, RIB_HALF_WIDTH * 0.72, RIB_HALF_DEPTH * 0.72, ghostMat);
  const flexEdges = auxeticLattice.edges.filter((edge) => edge.kind === "inclined");
  const flex = makeRibbon(flexEdges, RIB_HALF_WIDTH * 1.08, RIB_HALF_DEPTH * 0.72, flexMat);
  scene.add(solid.mesh, ghost.mesh, flex.mesh);
  ghost.mesh.castShadow = false;
  flex.mesh.castShadow = false;
  flex.mesh.renderOrder = 2;

  const restNodes = auxeticLattice.sample(AUXETIC_SPEC.theta0).nodes;
  updateRibbon(ghost, restNodes, 0);

  const jointGeo = new THREE.SphereGeometry(JUNCTION_RADIUS, 22, 14);
  const joints = new THREE.InstancedMesh(jointGeo, polymer, auxeticLattice.nodes.length);
  joints.castShadow = true;
  joints.receiveShadow = true;
  joints.frustumCulled = false;
  scene.add(joints);
  const dummy = new THREE.Object3D();

  const open = auxeticLattice.sample(AUXETIC_SPEC.theta1);
  const railHalf = Math.max(
    ...open.nodes.map((p) => Math.abs(p.x)),
    Math.abs(open.gauge.xL),
    Math.abs(open.gauge.xR),
  ) + 1.45;
  const metal = new THREE.MeshStandardMaterial({ color: 0x2c343e, metalness: 0.72, roughness: 0.34 });
  const slotMat = new THREE.MeshStandardMaterial({ color: 0x141920, metalness: 0.4, roughness: 0.6 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x3c4652, metalness: 0.64, roughness: 0.38 });

  const railGeo = new THREE.BoxGeometry(railHalf * 2, 0.24, 0.58);
  const slotGeo = new THREE.BoxGeometry(railHalf * 2 * 0.94, 0.07, 0.62);
  const bottomRail = new THREE.Mesh(railGeo, metal);
  bottomRail.position.y = -0.86;
  bottomRail.castShadow = true;
  bottomRail.receiveShadow = true;
  const bottomSlot = new THREE.Mesh(slotGeo, slotMat);
  bottomSlot.position.y = -0.7;
  const topRail = new THREE.Mesh(railGeo, metal);
  topRail.castShadow = true;
  const topSlot = new THREE.Mesh(slotGeo, slotMat);
  scene.add(bottomRail, bottomSlot, topRail, topSlot);

  const shoeGeo = new THREE.BoxGeometry(0.36, 0.32, 0.46);
  const stemGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 10);
  const bottomShoes = new THREE.InstancedMesh(shoeGeo, shoeMat, auxeticLattice.bottomIds.length);
  const topShoes = new THREE.InstancedMesh(shoeGeo, shoeMat, auxeticLattice.topIds.length);
  const bottomStems = new THREE.InstancedMesh(stemGeo, shoeMat, auxeticLattice.bottomIds.length);
  const topStems = new THREE.InstancedMesh(stemGeo, shoeMat, auxeticLattice.topIds.length);
  for (const mesh of [bottomShoes, topShoes, bottomStems, topStems]) {
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  const amberMain = makeArrow(0xffb703);
  const amberLeft = makeArrow(0xffb703);
  const amberRight = makeArrow(0xffb703);
  const mintLeft = makeArrow(0x06d6a0);
  const mintRight = makeArrow(0x06d6a0);
  scene.add(amberMain, amberLeft, amberRight, mintLeft, mintRight);

  const bone = new THREE.LineBasicMaterial({ color: 0xe7e1d5, transparent: true });
  const boneDim = new THREE.LineDashedMaterial({
    color: 0xe7e1d5,
    transparent: true,
    dashSize: 0.14,
    gapSize: 0.09,
  });
  const gaugeLine = new THREE.Line(new THREE.BufferGeometry(), bone);
  const hBracket = new THREE.Line(new THREE.BufferGeometry(), bone);
  const wBracket = new THREE.Line(new THREE.BufferGeometry(), bone);
  const hBase = new THREE.Line(new THREE.BufferGeometry(), boneDim);
  const wBase = new THREE.Line(new THREE.BufferGeometry(), boneDim);
  const zTick = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true }));
  scene.add(gaugeLine, hBracket, wBracket, hBase, wBase, zTick);

  const up = new THREE.Vector3(0, 1, 0);
  const out = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const camOffset = new THREE.Vector3();
  const fitCorner = new THREE.Vector3();
  const labelBox = { minX: 16, maxX: 4000, minY: 16, maxY: 4000 };

  const callouts = document.getElementById("callouts");
  const calloutEls = new Map<string, HTMLDivElement>();

  let composer: EffectComposer | null = null;
  let bloom: UnrealBloomPass | null = null;
  if (!lite) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.16, 0.32, 0.86);
    composer.addPass(bloom);
  }

  const restGauge = auxeticLattice.sample(AUXETIC_SPEC.theta0).gauge;
  const ndc = new THREE.Vector3();

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    composer?.setSize(w, h);
    bloom?.setSize(w, h);
  }

  function placeShoes(mesh: THREE.InstancedMesh, stems: THREE.InstancedMesh, pads: Vec2[], sign: number) {
    pads.forEach((pad, i) => {
      dummy.position.set(pad.x, pad.y + sign * 0.48, 0);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(pad.x, pad.y + sign * 0.22, 0);
      dummy.scale.set(1, 0.28, 1);
      dummy.updateMatrix();
      stems.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    stems.instanceMatrix.needsUpdate = true;
  }

  function projectCallout(id: string, text: string, x: number, y: number, z: number, opacity: number) {
    if (!callouts) return;
    let el = calloutEls.get(id);
    if (!el) {
      el = document.createElement("div");
      el.className = "callout";
      el.dataset.id = id;
      callouts.appendChild(el);
      calloutEls.set(id, el);
    }
    el.textContent = text;
    if (opacity < 0.04) {
      el.hidden = true;
      return;
    }
    ndc.set(x, y, z).project(camera);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    let sx = (ndc.x * 0.5 + 0.5) * w;
    let sy = (-ndc.y * 0.5 + 0.5) * h;
    const onScreen = ndc.z < 1 && sx > -80 && sx < w + 80 && sy > -40 && sy < h + 40;
    if (onScreen) {
      sx = Math.min(labelBox.maxX, Math.max(labelBox.minX, sx));
      sy = Math.min(labelBox.maxY, Math.max(labelBox.minY, sy));
    }
    el.hidden = !onScreen;
    el.style.opacity = String(opacity);
    el.style.transform = `translate(-50%, -120%) translate(${sx}px, ${sy}px)`;
  }

  function safeNdc(aspect: number, shotId: number, compare: number) {
    if (aspect < 0.85) return { l: -0.92, r: 0.92, b: 0.16, t: 0.46 };
    if (shotId === 5 || compare > 0.35) return { l: -0.78, r: 0.38, b: -0.5, t: 0.88 };
    return { l: -0.42, r: 0.46, b: -0.52, t: 0.9 };
  }

  function placeCamera(state: SceneState) {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    camera.fov = state.camera.fov;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const portrait = w < 860;
    labelBox.minX = portrait || state.shot.id === 2 ? 16 : 390;
    labelBox.maxX = portrait ? w - 16 : w - (state.shot.id === 5 ? 470 : 336);
    labelBox.minY = portrait ? 148 : 20;
    labelBox.maxY = h - (portrait ? 210 : 186);

    if (state.shot.id === 2) {
      camera.position.set(state.camera.x, state.camera.y, state.camera.z);
      camera.lookAt(state.camera.tx, state.camera.ty, state.camera.tz);
      camera.updateMatrixWorld(true);
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of state.mechanical.nodes) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const rail = Math.max(Math.abs(minX), Math.abs(maxX)) + (aspect < 0.85 ? 0.3 : 1.45);
    minX = -rail;
    maxX = rail;
    minY = Math.min(minY, -1.2);
    const arrow = state.amber > 0.04 ? 0.95 + Math.max(0.15, state.gripDisplacement) * 0.38 : 0.15;
    maxY = Math.max(maxY, state.mechanical.topY + 1.15 + arrow * 1.15);

    camTarget.set(state.camera.tx, state.camera.ty, state.camera.tz);
    if (state.shot.id === 5 || state.comparison.opacity > 0.2) camTarget.x += 1.8;
    camOffset.set(state.camera.x - state.camera.tx, state.camera.y - state.camera.ty, state.camera.z - state.camera.tz);
    const safe = safeNdc(aspect, state.shot.id, state.comparison.opacity);
    const inside = (scale: number) => {
      camera.position.copy(camTarget).addScaledVector(camOffset, scale);
      camera.lookAt(camTarget);
      camera.updateMatrixWorld(true);
      for (const x of [minX, maxX]) {
        for (const y of [minY, maxY]) {
          for (const z of [-0.45, 0.45]) {
            fitCorner.set(x, y, z).project(camera);
            if (fitCorner.x < safe.l || fitCorner.x > safe.r || fitCorner.y < safe.b || fitCorner.y > safe.t) return false;
          }
        }
      }
      return true;
    };
    let lo = 1;
    let hi = aspect < 0.85 ? 3.1 : 2.15;
    let best = 1;
    let found = false;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (inside(mid)) {
        found = true;
        best = mid;
        hi = mid;
      } else lo = mid;
    }
    if (!found) best = hi;
    camera.position.copy(camTarget).addScaledVector(camOffset, best);
    camera.lookAt(camTarget);
    camera.updateMatrixWorld(true);
  }

  function render(state: SceneState) {
    const nodes = state.mechanical.nodes;
    updateRibbon(solid, nodes, state.lambda);
    updateRibbon(flex, nodes, state.lambda);
    nodes.forEach((node, i) => {
      dummy.position.set(node.x, node.y, 0);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      joints.setMatrixAt(i, dummy.matrix);
    });
    joints.instanceMatrix.needsUpdate = true;

    ghostMat.opacity = Math.max(state.ghost * 0.22, state.clipZ !== null ? 0.08 : 0);
    ghost.mesh.visible = ghostMat.opacity > 0.02;
    flexMat.opacity = state.flexure * 0.3;
    flex.mesh.visible = flexMat.opacity > 0.02;

    // A clipping plane on these hollow sweeps opens the rib interior and
    // reads as a cut joint. Thickness is shown by the oblique view and the Z tick.

    placeShoes(bottomShoes, bottomStems, state.mechanical.padsBottom, -1);
    placeShoes(topShoes, topStems, state.mechanical.padsTop, 1);
    const topY = state.mechanical.topY;
    topRail.position.y = topY + 0.86;
    topSlot.position.y = topY + 0.7;

    const lift = Math.max(0.15, state.gripDisplacement);
    pointArrow(amberMain, origin.set(0, topY + 1.15, 0.05), up, state.amber > 0.04 ? 0.95 + lift * 0.38 : 0);
    const span = Math.min(2.2, Math.abs(state.mechanical.gauge.xR) * 0.55);
    pointArrow(amberLeft, origin.set(-span, topY + 1.05, 0.02), up, state.amber > 0.2 ? 0.55 + lift * 0.22 : 0);
    pointArrow(amberRight, origin.set(span, topY + 1.05, 0.02), up, state.amber > 0.2 ? 0.55 + lift * 0.22 : 0);

    const midY = (state.mechanical.gauge.yB + state.mechanical.gauge.yT) / 2;
    const spread = 0.72 + Math.max(0, state.W - state.W0) * 0.4;
    pointArrow(
      mintLeft,
      origin.set(state.mechanical.gauge.xL - 0.08, midY, 0.05),
      out.set(-1, 0, 0),
      state.mint > 0.04 ? spread : 0,
    );
    pointArrow(
      mintRight,
      origin.set(state.mechanical.gauge.xR + 0.08, midY, 0.05),
      out.set(1, 0, 0),
      state.mint > 0.04 ? spread : 0,
    );

    const g = state.mechanical.gauge;
    const showGauge = state.gaugeOpacity > 0.04;
    gaugeLine.visible = showGauge;
    hBracket.visible = showGauge;
    wBracket.visible = showGauge;
    bone.opacity = state.gaugeOpacity;
    if (showGauge) {
      const z = 0.05;
      setPolyline(gaugeLine, [
        new THREE.Vector3(g.xL, g.yB, z),
        new THREE.Vector3(g.xR, g.yB, z),
        new THREE.Vector3(g.xR, g.yT, z),
        new THREE.Vector3(g.xL, g.yT, z),
        new THREE.Vector3(g.xL, g.yB, z),
      ]);
      const hx = g.xR + 0.72;
      setPolyline(hBracket, [
        new THREE.Vector3(hx - 0.18, g.yB, z),
        new THREE.Vector3(hx, g.yB, z),
        new THREE.Vector3(hx, g.yT, z),
        new THREE.Vector3(hx - 0.18, g.yT, z),
      ]);
      const wy = g.yT + 0.62;
      setPolyline(wBracket, [
        new THREE.Vector3(g.xL, wy - 0.16, z),
        new THREE.Vector3(g.xL, wy, z),
        new THREE.Vector3(g.xR, wy, z),
        new THREE.Vector3(g.xR, wy - 0.16, z),
      ]);
    }
    const showBase = state.baselineOpacity > 0.04;
    hBase.visible = showBase;
    wBase.visible = showBase;
    boneDim.opacity = state.baselineOpacity * 0.85;
    if (showBase) {
      const z = 0.04;
      const hx = restGauge.xR + 1.05;
      setPolyline(hBase, [
        new THREE.Vector3(hx - 0.14, restGauge.yB, z),
        new THREE.Vector3(hx, restGauge.yB, z),
        new THREE.Vector3(hx, restGauge.yT, z),
        new THREE.Vector3(hx - 0.14, restGauge.yT, z),
      ]);
      const wy = restGauge.yT + 1.0;
      setPolyline(wBase, [
        new THREE.Vector3(restGauge.xL, wy - 0.12, z),
        new THREE.Vector3(restGauge.xL, wy, z),
        new THREE.Vector3(restGauge.xR, wy, z),
        new THREE.Vector3(restGauge.xR, wy - 0.12, z),
      ]);
    }
    const showZ = state.clipZ !== null;
    zTick.visible = showZ;
    if (showZ) {
      setPolyline(zTick, [new THREE.Vector3(0.35, midY, -RIB_HALF_DEPTH), new THREE.Vector3(0.35, midY, RIB_HALF_DEPTH)]);
    }

    placeCamera(state);

    projectCallout("honey", COPY.honeycomb, (g.xL + g.xR) / 2 - 1.1, g.yT + 0.55, 0.2, state.labels.establish * 0.85);
    projectCallout("gauge", COPY.gauge, (g.xL + g.xR) / 2, (g.yB + g.yT) / 2, 0.2, state.labels.establish * 0.95);
    projectCallout("y", COPY.yLoad, -1.35, topY + 0.35, 0.1, Math.max(state.labels.establish, state.amber * 0.9));
    projectCallout("x", COPY.xTrans, g.xR - 0.55, g.yT + 0.85, 0.1, Math.max(state.labels.establish, state.mint));
    projectCallout("z", COPY.zThick, 0.55, midY + 0.35, 0.2, showZ ? 1 : 0);
    projectCallout("ribs", COPY.ribs, 0.15, midY + 0.35, 0.15, state.labels.mechanism);
    projectCallout("joints", COPY.junctions, -0.85, midY - 0.15, 0.15, state.labels.mechanism);
    projectCallout("pins", COPY.noPins, 0.9, midY - 0.85, 0.1, state.labels.mechanism * 0.95);
    projectCallout("flex", COPY.flex, g.xL + 0.85, midY + 0.15, 0.2, state.labels.flexure);
    projectCallout("poisson", COPY.poisson, (g.xL + g.xR) / 2, g.yT + 0.72, 0.1, state.labels.poisson);
    projectCallout("unload", COPY.returning, -1.2, topY + 0.45, 0.1, state.unloadCue * (1 - state.labels.comparison));

    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  resize();
  return {
    render,
    resize,
    dispose() {
      composer?.dispose();
      renderer.dispose();
    },
  };
}
