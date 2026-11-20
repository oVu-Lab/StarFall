import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AssetManager } from '../engine/AssetManager';
import type { ShipConfig, ShipVisualHandle } from '../types/game';

/**
 * Authoritative local-space hardpoints for the player's VX-9 Vanguard interceptor.
 * Forward is -Z, up is +Y, right is +X.
 * Cannon muzzle coordinates match WEAPON_CONFIGS.player_pulse_twin.muzzleOffsets exactly.
 */
export const VANGUARD_HARDPOINTS = {
  cannonMuzzles: [
    [-1.48, -0.14, -1.65] as const,
    [1.48, -0.14, -1.65] as const,
  ],
  thrusters: [
    [-0.64, 0.05, 2.62] as const,
    [0.64, 0.05, 2.62] as const,
  ],
  intakes: [
    [-0.98, -0.02, -0.78] as const,
    [0.98, -0.02, -0.78] as const,
  ],
} as const;

const VANGUARD_EXHAUST_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const VANGUARD_EXHAUST_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uCoreColor;
  uniform vec3 uOuterColor;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    // ConeGeometry uv.y = 0.0 at base (thruster lip), 1.0 at apex (aft tip)
    float axial = clamp(1.0 - vUv.y, 0.0, 1.0);
    // Smooth tip fade eliminates sharp geometric cone silhouette; hottest at thruster lip
    float tipFade = smoothstep(0.0, 0.42, axial) * pow(axial, 1.65);
    float edgeSoft = pow(abs(dot(vNormalView, vViewDir)), 0.85);

    // Subtle Mach shock-diamond plasma ripples accelerating aft
    float diamonds = 0.78 + 0.22 * pow(0.5 + 0.5 * sin(axial * 18.0 + uTime * 42.0), 2.0);
    float coreMask = smoothstep(0.42, 0.98, axial) * edgeSoft;

    vec3 col = mix(uOuterColor, uCoreColor, coreMask * (0.65 + 0.35 * uIntensity));
    float alpha = tipFade * edgeSoft * diamonds * (0.38 + 0.54 * uIntensity);
    gl_FragColor = vec4(col * (1.2 + uIntensity * 0.95), alpha);
  }
`;

interface LoftSection {
  z: number;
  /** Counter-clockwise [x, y] contour when viewed from +Z looking toward -Z */
  points: Array<[number, number]>;
}

/**
 * Generates a closed, manifold, outward-facing lofted BufferGeometry connecting
 * arbitrary cross-section contours along Z with world-scale arc-length UVs.
 */
function createLoftedHull(
  sections: LoftSection[],
  uvScale = 0.42,
  creaseAngle = Math.PI * 0.22,
): THREE.BufferGeometry {
  const numSections = sections.length;
  const ringCount = sections[0].points.length;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s < numSections; s++) {
    const sec = sections[s];
    let arcLen = 0;
    for (let k = 0; k <= ringCount; k++) {
      const idx = k % ringCount;
      const [x, y] = sec.points[idx];
      if (k > 0) {
        const [px, py] = sec.points[(k - 1) % ringCount];
        arcLen += Math.hypot(x - px, y - py);
      }
      positions.push(x, y, sec.z);
      uvs.push(arcLen * uvScale, sec.z * uvScale);
    }
  }

  const stride = ringCount + 1;
  for (let s = 0; s < numSections - 1; s++) {
    for (let k = 0; k < ringCount; k++) {
      const a = s * stride + k;
      const b = s * stride + k + 1;
      const c = (s + 1) * stride + k + 1;
      const d = (s + 1) * stride + k;
      // Verified outward winding: (b - a) x (d - a) = v_ring x v_aft
      indices.push(a, b, d, b, c, d);
    }
  }

  // Front cap (facing -Z)
  const firstSec = sections[0];
  let cx0 = 0;
  let cy0 = 0;
  for (const [x, y] of firstSec.points) {
    cx0 += x;
    cy0 += y;
  }
  cx0 /= ringCount;
  cy0 /= ringCount;
  const frontCenterIdx = positions.length / 3;
  positions.push(cx0, cy0, firstSec.z);
  uvs.push(cx0 * uvScale, cy0 * uvScale);
  for (let k = 0; k < ringCount; k++) {
    indices.push(frontCenterIdx, k + 1, k);
  }

  // Rear cap (facing +Z)
  const lastSec = sections[numSections - 1];
  let cx1 = 0;
  let cy1 = 0;
  for (const [x, y] of lastSec.points) {
    cx1 += x;
    cy1 += y;
  }
  cx1 /= ringCount;
  cy1 /= ringCount;
  const backCenterIdx = positions.length / 3;
  positions.push(cx1, cy1, lastSec.z);
  uvs.push(cx1 * uvScale, cy1 * uvScale);
  const lastBase = (numSections - 1) * stride;
  for (let k = 0; k < ringCount; k++) {
    indices.push(backCenterIdx, lastBase + k, lastBase + k + 1);
  }

  const raw = new THREE.BufferGeometry();
  raw.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  raw.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  raw.setIndex(indices);
  const creased = toCreasedNormals(raw, creaseAngle);
  raw.dispose();
  return creased;
}

/**
 * Generates an extruded, beveled stealth armor plate lying in the XZ plane
 * (thickness along Y), centered vertically on Y = 0, with consistent world-scale planar UVs.
 */
function createStealthPlateXZ(
  pointsXZ: Array<[number, number]>,
  thickness: number,
  bevelSize = 0.025,
  bevelThickness = 0.02,
  uvScale = 0.36,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(pointsXZ[0][0], pointsXZ[0][1]);
  for (let i = 1; i < pointsXZ.length; i++) {
    shape.lineTo(pointsXZ[i][0], pointsXZ[i][1]);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: bevelSize > 0 && bevelThickness > 0,
    bevelThickness,
    bevelSize,
    bevelSegments: 2,
  });

  geo.translate(0, 0, -thickness * 0.5);
  geo.rotateX(Math.PI / 2);

  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) * uvScale, pos.getZ(i) * uvScale);
  }
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates a beveled XZ stealth plate with a clean pivot-aware anhedral slope
 * starting at pivotX (so inner roots connect seamlessly without step cliffs!).
 */
function createSlopedPlateXZ(
  pointsXZ: Array<[number, number]>,
  thickness: number,
  bevelSize: number,
  bevelThickness: number,
  pivotX: number,
  slopePerX: number,
  uvScale = 0.36,
): THREE.BufferGeometry {
  const geo = createStealthPlateXZ(pointsXZ, thickness, bevelSize, bevelThickness, uvScale);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const dy = Math.max(0, x - pivotX) * slopePerX;
    pos.setY(i, pos.getY(i) + dy);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates an extruded, beveled vertical fin / stabilizer lying in the YZ plane
 * (thickness along X), centered on X = 0. Points are [z, y].
 */
function createStealthFinZY(
  pointsZY: Array<[number, number]>,
  thickness: number,
  bevelSize = 0.02,
  bevelThickness = 0.018,
  uvScale = 0.42,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(pointsZY[0][0], pointsZY[0][1]);
  for (let i = 1; i < pointsZY.length; i++) {
    shape.lineTo(pointsZY[i][0], pointsZY[i][1]);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: bevelSize > 0 && bevelThickness > 0,
    bevelThickness,
    bevelSize,
    bevelSegments: 2,
  });

  geo.translate(0, 0, -thickness * 0.5);
  geo.rotateY(-Math.PI / 2);

  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getZ(i) * uvScale, pos.getY(i) * uvScale);
  }
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Mirrors a BufferGeometry cleanly across X = 0 while reversing triangle winding
 * so face normals remain strictly outward-facing after merging.
 */
function mirrorGeometryX(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = source.index ? source.toNonIndexed() : source.clone();
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const uv = geo.attributes.uv;

  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, -pos.getX(i));
    if (norm) norm.setX(i, -norm.getX(i));
  }

  for (let i = 0; i < pos.count; i += 3) {
    const i1 = i + 1;
    const i2 = i + 2;

    const px = pos.getX(i1);
    const py = pos.getY(i1);
    const pz = pos.getZ(i1);
    pos.setXYZ(i1, pos.getX(i2), pos.getY(i2), pos.getZ(i2));
    pos.setXYZ(i2, px, py, pz);

    if (norm) {
      const nx = norm.getX(i1);
      const ny = norm.getY(i1);
      const nz = norm.getZ(i1);
      norm.setXYZ(i1, norm.getX(i2), norm.getY(i2), norm.getZ(i2));
      norm.setXYZ(i2, nx, ny, nz);
    }

    if (uv) {
      const u = uv.getX(i1);
      const v = uv.getY(i1);
      uv.setXY(i1, uv.getX(i2), uv.getY(i2));
      uv.setXY(i2, u, v);
    }
  }

  pos.needsUpdate = true;
  if (norm) norm.needsUpdate = true;
  if (uv) uv.needsUpdate = true;
  return geo;
}

/**
 * Builds an exact point-to-point structural strut aligned between 3D endpoints a and b,
 * guaranteeing zero angular drift or surface protrusion on faceted canopy/hull seams.
 */
function createStrut(
  a: [number, number, number],
  b: [number, number, number],
  width: number,
  height: number,
  extraLen = 0.02,
): THREE.BufferGeometry {
  const va = new THREE.Vector3(a[0], a[1], a[2]);
  const vb = new THREE.Vector3(b[0], b[1], b[2]);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const mid = va.clone().add(vb).multiplyScalar(0.5);

  const geo = new THREE.BoxGeometry(width, height, len + extraLen);
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    dir.normalize(),
  );
  const mat = new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1));
  geo.applyMatrix4(mat);
  return geo;
}

/**
 * Applies a transform matrix and normalizes attributes to non-indexed (position, normal, uv)
 * for clean draw-call-consolidated merging.
 */
function normalizeForMerge(
  source: THREE.BufferGeometry,
  matrix?: THREE.Matrix4,
): THREE.BufferGeometry {
  const g = source.index ? source.toNonIndexed() : source.clone();
  if (matrix) g.applyMatrix4(matrix);

  for (const attr of Object.keys(g.attributes)) {
    if (attr !== 'position' && attr !== 'normal' && attr !== 'uv') {
      g.deleteAttribute(attr);
    }
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    const count = g.attributes.position.count;
    const uvArr = new Float32Array(count * 2);
    const pos = g.attributes.position;
    for (let i = 0; i < count; i++) {
      uvArr[i * 2] = pos.getX(i) * 0.4;
      uvArr[i * 2 + 1] = pos.getZ(i) * 0.4;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  }
  return g;
}

type MaterialBucketKey =
  | 'primaryArmor'
  | 'darkComposite'
  | 'brushedTitanium'
  | 'gunmetalDark'
  | 'squadronAccent'
  | 'emissiveCyan'
  | 'emissiveNavWhite'
  | 'cockpitHud';

class GeometryAssembler {
  private buckets: Record<MaterialBucketKey, THREE.BufferGeometry[]> = {
    primaryArmor: [],
    darkComposite: [],
    brushedTitanium: [],
    gunmetalDark: [],
    squadronAccent: [],
    emissiveCyan: [],
    emissiveNavWhite: [],
    cockpitHud: [],
  };
  private readonly mat4 = new THREE.Matrix4();
  private readonly euler = new THREE.Euler();
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();

  public add(
    bucket: MaterialBucketKey,
    geo: THREE.BufferGeometry,
    position?: [number, number, number],
    rotation?: [number, number, number],
    scale?: [number, number, number],
    disposeSource = true,
  ): void {
    this.pos.set(position ? position[0] : 0, position ? position[1] : 0, position ? position[2] : 0);
    this.euler.set(rotation ? rotation[0] : 0, rotation ? rotation[1] : 0, rotation ? rotation[2] : 0);
    this.quat.setFromEuler(this.euler);
    this.scl.set(scale ? scale[0] : 1, scale ? scale[1] : 1, scale ? scale[2] : 1);
    this.mat4.compose(this.pos, this.quat, this.scl);

    this.buckets[bucket].push(normalizeForMerge(geo, this.mat4));
    if (disposeSource) geo.dispose();
  }

  /** Adds a geometry on the right (+X) side and automatically adds its properly wound mirror on -X. */
  public addSymmetric(
    bucket: MaterialBucketKey,
    geo: THREE.BufferGeometry,
    position?: [number, number, number],
    rotation?: [number, number, number],
    scale?: [number, number, number],
    disposeSource = true,
  ): void {
    this.pos.set(position ? position[0] : 0, position ? position[1] : 0, position ? position[2] : 0);
    this.euler.set(rotation ? rotation[0] : 0, rotation ? rotation[1] : 0, rotation ? rotation[2] : 0);
    this.quat.setFromEuler(this.euler);
    this.scl.set(scale ? scale[0] : 1, scale ? scale[1] : 1, scale ? scale[2] : 1);
    this.mat4.compose(this.pos, this.quat, this.scl);

    const right = normalizeForMerge(geo, this.mat4);
    const left = mirrorGeometryX(right);
    this.buckets[bucket].push(right, left);
    if (disposeSource) geo.dispose();
  }

  public finalize(
    root: THREE.Group,
    materials: Record<MaterialBucketKey, THREE.Material>,
    trackedGeometries: THREE.BufferGeometry[],
  ): void {
    const keys = Object.keys(this.buckets) as MaterialBucketKey[];
    for (const key of keys) {
      const list = this.buckets[key];
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      trackedGeometries.push(merged);
      const mesh = new THREE.Mesh(merged, materials[key]);
      mesh.name = `vanguard-${key}`;
      const isEmissive =
        key === 'emissiveCyan' || key === 'emissiveNavWhite' || key === 'cockpitHud';
      mesh.castShadow = !isEmissive;
      mesh.receiveShadow = !isEmissive;
      root.add(mesh);
    }
  }
}

/**
 * Builds the hero high-detail hard-surface 3D model for the player's VX-9 Vanguard interceptor.
 * Preserves exact flight origin, coordinate axes (-Z forward, +Y up, +X right), bounding envelope,
 * weapon muzzle offsets ([±1.48, -0.14, -1.65]), and ShieldField hull-hugging compatibility.
 */
export function buildVanguardModel(
  ship: ShipConfig,
  textureResolution: 256 | 512 | 1024 = 512,
): ShipVisualHandle {
  const texRes = AssetManager.acquireVanguardTextures(textureResolution);
  const tex = texRes.bundle;
  const glowSpriteTex = AssetManager.acquireGlowSprite();

  const root = new THREE.Group();
  root.name = `ship-${ship.id}-vanguard`;

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  // --- Calibrated PBR Materials (clear value, roughness & metalness contrast) ---

  // 1. Primary Military Spacecraft Armor (cool slate-navy satin composite)
  const primaryArmorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#4a5b73'),
      map: tex.armorAlbedo,
      roughnessMap: tex.armorRoughness,
      bumpMap: tex.armorBump,
      bumpScale: 0.024,
      metalness: 0.64,
      roughness: 0.44,
      envMapIntensity: 1.4,
    }),
  );

  // 2. Dark Stealth Composite (matte obsidian-navy inner armor, spine, wing inlays & belly bays)
  const darkCompositeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#182131'),
      map: tex.armorAlbedo,
      roughnessMap: tex.armorRoughness,
      bumpMap: tex.armorBump,
      bumpScale: 0.018,
      metalness: 0.42,
      roughness: 0.68,
      envMapIntensity: 1.05,
    }),
  );

  // 3. Brushed Machined Titanium (intake lips, turbine blades, coolant pipes, cannon rails, vector paddles)
  const brushedTitaniumMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#bac8d8'),
      roughnessMap: tex.titaniumRoughness,
      metalness: 0.92,
      roughness: 0.24,
      envMapIntensity: 1.7,
    }),
  );

  // 4. Dark Structural Gunmetal (chassis ribs, cannon cradles, intake throats, thruster frames, canopy frame)
  const gunmetalDarkMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#222c3c'),
      roughnessMap: tex.titaniumRoughness,
      metalness: 0.82,
      roughness: 0.36,
      envMapIntensity: 1.35,
    }),
  );

  // 5. Tactical Squadron Livery Accent (painted satin steel-azure military stripes — NOT glowing!)
  const squadronAccentMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#0284c7'),
      roughnessMap: tex.armorRoughness,
      metalness: 0.28,
      roughness: 0.35,
      envMapIntensity: 1.15,
    }),
  );

  // 6. Controlled Electric-Cyan Emissive (cannon conduits, reactor core, exhaust louvers, wingtip beacons)
  const emissiveCyanMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#7dd3fc'),
      emissive: new THREE.Color(ship.colors.hullTrim),
      emissiveIntensity: 1.4,
      metalness: 0.15,
      roughness: 0.18,
      toneMapped: false,
    }),
  );

  // 7. Crisp Navigation Strobe Accent (subtle cool-white leading edge & tailtip strobe tips)
  const emissiveNavWhiteMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#e0f2fe'),
      emissive: new THREE.Color('#bae6fd'),
      emissiveIntensity: 1.55,
      metalness: 0.1,
      roughness: 0.15,
      toneMapped: false,
    }),
  );

  // 8. Cockpit Interior Avionics Glow (refined cyan tactical display readouts)
  const cockpitHudMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#38bdf8'),
      emissive: new THREE.Color('#0ea5e9'),
      emissiveIntensity: 1.35,
      metalness: 0.1,
      roughness: 0.2,
      toneMapped: false,
    }),
  );

  // 9. Realistic Tinted Reflective Cockpit Canopy Glass (semi-transparent clearcoat sapphire)
  const canopyGlassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#061528'),
      metalness: 0.18,
      roughness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      reflectivity: 1.0,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      envMapIntensity: 2.35,
    }),
  );

  // 10. Thruster Exhaust Core & Volumetric Plume Materials
  const thrusterCoreMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(ship.colors.engineCore),
      emissive: new THREE.Color(ship.colors.engineGlow),
      emissiveIntensity: 2.4,
      roughness: 0.15,
      metalness: 0.1,
      toneMapped: false,
    }),
  );

  const exhaustMat = trackMat(
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.36 },
        uCoreColor: { value: new THREE.Color(ship.colors.engineCore) },
        uOuterColor: { value: new THREE.Color(ship.colors.engineGlow) },
      },
      vertexShader: VANGUARD_EXHAUST_VERTEX,
      fragmentShader: VANGUARD_EXHAUST_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );

  const glowSpriteMat = trackMat(
    new THREE.SpriteMaterial({
      map: glowSpriteTex,
      color: new THREE.Color(ship.colors.engineGlow),
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );

  const asm = new GeometryAssembler();

  // =========================================================================
  // 1. SCULPTED MULTI-STATION STEALTH FUSELAGE CORE (z = -3.55 to +2.46)
  // =========================================================================
  const makeHexSection = (
    z: number,
    topW: number,
    topY: number,
    midW: number,
    midTopY: number,
    midBotY: number,
    botW: number,
    botY: number,
  ): LoftSection => ({
    z,
    points: [
      [0, topY + 0.022],
      [-topW, topY],
      [-midW, midTopY],
      [-midW * 0.94, midBotY],
      [-botW, botY],
      [0, botY - 0.016],
      [botW, botY],
      [midW * 0.94, midBotY],
      [midW, midTopY],
      [topW, topY],
    ],
  });

  const fuselageGeo = createLoftedHull(
    [
      makeHexSection(-3.55, 0.032, -0.10, 0.058, -0.12, -0.16, 0.032, -0.18),
      makeHexSection(-3.10, 0.145, -0.01, 0.245, -0.055, -0.19, 0.145, -0.25),
      makeHexSection(-2.42, 0.255, 0.115, 0.425, 0.025, -0.21, 0.28, -0.31),
      makeHexSection(-1.62, 0.34, 0.18, 0.565, 0.095, -0.22, 0.38, -0.34),
      makeHexSection(-0.82, 0.36, 0.36, 0.64, 0.21, -0.24, 0.46, -0.38),
      makeHexSection(-0.08, 0.38, 0.39, 0.67, 0.25, -0.24, 0.50, -0.40),
      makeHexSection(0.95, 0.36, 0.35, 0.65, 0.23, -0.22, 0.46, -0.36),
      makeHexSection(1.92, 0.30, 0.26, 0.53, 0.17, -0.18, 0.36, -0.28),
      makeHexSection(2.44, 0.24, 0.16, 0.36, 0.10, -0.14, 0.24, -0.20),
    ],
    0.45,
    Math.PI * 0.22,
  );
  asm.add('primaryArmor', fuselageGeo);

  // Flush sculpted dark stealth dorsal nose armor hood (conforms smoothly to nose contour — zero floating!)
  const noseHoodGeo = createLoftedHull(
    [
      {
        z: -3.48,
        points: [
          [0, -0.068],
          [-0.048, -0.088],
          [-0.042, -0.118],
          [0.042, -0.118],
          [0.048, -0.088],
        ],
      },
      {
        z: -3.08,
        points: [
          [0, 0.028],
          [-0.14, 0.005],
          [-0.165, -0.035],
          [0.165, -0.035],
          [0.14, 0.005],
        ],
      },
      {
        z: -2.42,
        points: [
          [0, 0.155],
          [-0.22, 0.132],
          [-0.255, 0.082],
          [0.255, 0.082],
          [0.22, 0.132],
        ],
      },
      {
        z: -2.28,
        points: [
          [0, 0.175],
          [-0.21, 0.155],
          [-0.24, 0.11],
          [0.24, 0.11],
          [0.21, 0.155],
        ],
      },
    ],
    0.55,
    Math.PI * 0.22,
  );
  asm.add('darkComposite', noseHoodGeo);

  // Faceted brushed-titanium nose radar sensor tip
  asm.add('brushedTitanium', new THREE.BoxGeometry(0.10, 0.052, 0.22), [0, -0.135, -3.45], [0.06, 0, 0]);

  // Sculpted nose side cheek armor plates (conformal beveled cheek sponsons flanking cockpit)
  const noseCheekPlate = createStealthPlateXZ(
    [
      [0.20, -3.02],
      [0.44, -2.38],
      [0.57, -1.62],
      [0.64, -0.92],
      [0.40, -0.92],
      [0.33, -1.75],
      [0.22, -2.42],
    ],
    0.095,
    0.02,
    0.018,
    0.45,
  );
  asm.addSymmetric('primaryArmor', noseCheekPlate, [0, 0.08, 0], [0, 0, -0.22]);

  // Tactical Squadron Azure-Blue Cheek Livery Stripes (conformal painted bands inboard of intakes)
  const cheekStripe = createStealthPlateXZ(
    [
      [0.45, -1.82],
      [0.64, -1.48],
      [0.66, -1.10],
      [0.46, -1.26],
    ],
    0.072,
    0.012,
    0.012,
    0.6,
  );
  asm.addSymmetric('squadronAccent', cheekStripe, [0, 0.125, 0], [0, 0, -0.22]);

  // =========================================================================
  // 2. REFINED COCKPIT INTERIOR, FACETED STEALTH CANOPY FRAME & SMOKED GLASS
  // =========================================================================
  // Recessed dark cockpit tub
  asm.add('gunmetalDark', new THREE.BoxGeometry(0.46, 0.16, 1.38), [0, 0.12, -1.58]);

  // High-back sculpted pilot ejection seat + headrest + side bolsters
  asm.add('darkComposite', new THREE.BoxGeometry(0.24, 0.27, 0.10), [0, 0.24, -1.24], [-0.26, 0, 0]);
  asm.add('gunmetalDark', new THREE.BoxGeometry(0.16, 0.12, 0.08), [0, 0.365, -1.18], [-0.15, 0, 0]);
  asm.addSymmetric('darkComposite', new THREE.BoxGeometry(0.05, 0.21, 0.14), [0.14, 0.22, -1.28], [-0.2, 0, 0]);
  asm.add('darkComposite', new THREE.BoxGeometry(0.26, 0.08, 0.32), [0, 0.12, -1.42]);

  // Forward angled cockpit instrument dashboard & subtle holographic HUD combiner
  asm.add('gunmetalDark', new THREE.BoxGeometry(0.36, 0.12, 0.34), [0, 0.175, -1.98], [0.22, 0, 0]);
  asm.add('cockpitHud', new THREE.BoxGeometry(0.27, 0.026, 0.08), [0, 0.24, -1.90], [0.35, 0, 0]);
  asm.add('cockpitHud', new THREE.BoxGeometry(0.13, 0.085, 0.012), [0, 0.29, -1.86], [-0.42, 0, 0]);
  asm.addSymmetric('cockpitHud', new THREE.BoxGeometry(0.028, 0.015, 0.26), [0.16, 0.195, -1.66]);

  // Sleek Sculpted Aft Canopy Spine Fairing (flows organically from canopy arch into dorsal spine!)
  const canopySpineFairing = createLoftedHull(
    [
      {
        z: -1.14,
        points: [
          [0, 0.495],
          [-0.22, 0.42],
          [-0.31, 0.28],
          [-0.31, 0.20],
          [0.31, 0.20],
          [0.31, 0.28],
          [0.22, 0.42],
        ],
      },
      {
        z: -0.68,
        points: [
          [0, 0.485],
          [-0.24, 0.445],
          [-0.34, 0.33],
          [-0.34, 0.22],
          [0.34, 0.22],
          [0.34, 0.33],
          [0.24, 0.445],
        ],
      },
      {
        z: -0.14,
        points: [
          [0, 0.445],
          [-0.22, 0.415],
          [-0.30, 0.34],
          [-0.30, 0.24],
          [0.30, 0.24],
          [0.30, 0.34],
          [0.22, 0.415],
        ],
      },
      {
        z: 0.22,
        points: [
          [0, 0.39],
          [-0.18, 0.375],
          [-0.25, 0.33],
          [-0.25, 0.26],
          [0.25, 0.26],
          [0.25, 0.33],
          [0.18, 0.375],
        ],
      },
    ],
    0.5,
    Math.PI * 0.24,
  );
  asm.add('darkComposite', canopySpineFairing);

  // Subtle brushed-titanium canopy spine ridge trim along aft fairing
  asm.add('gunmetalDark', new THREE.BoxGeometry(0.14, 0.032, 0.96), [0, 0.475, -0.58], [-0.075, 0, 0]);

  // Faceted Angular Stealth Canopy Framing (point-to-point conformal struts locked to glass vertices)
  // Forward windshield A-pillars (nose sill -> brow corner)
  asm.addSymmetric('gunmetalDark', createStrut([0.14, 0.135, -2.40], [0.19, 0.365, -1.88], 0.044, 0.036, 0.03));
  // Upper-side longitudinal canopy bow rails (brow -> mid -> aft fairing)
  asm.addSymmetric('gunmetalDark', createStrut([0.19, 0.365, -1.88], [0.215, 0.42, -1.42], 0.038, 0.034, 0.02));
  asm.addSymmetric('gunmetalDark', createStrut([0.215, 0.42, -1.42], [0.22, 0.415, -1.04], 0.038, 0.034, 0.02));
  // Lower armored canopy sill rails (nose -> brow -> mid -> aft)
  asm.addSymmetric('gunmetalDark', createStrut([0.175, 0.095, -2.40], [0.245, 0.225, -1.88], 0.056, 0.048, 0.03));
  asm.addSymmetric('gunmetalDark', createStrut([0.245, 0.225, -1.88], [0.285, 0.27, -1.42], 0.058, 0.050, 0.03));
  asm.addSymmetric('gunmetalDark', createStrut([0.285, 0.27, -1.42], [0.295, 0.28, -1.04], 0.060, 0.052, 0.03));
  // Forward windshield armored brow arch (top stealth visor seam)
  asm.addSymmetric('gunmetalDark', createStrut([0, 0.43, -1.88], [0.19, 0.365, -1.88], 0.038, 0.036, 0.02));
  asm.addSymmetric('gunmetalDark', createStrut([0.19, 0.365, -1.88], [0.245, 0.225, -1.88], 0.036, 0.036, 0.02));
  // Mid-canopy faceted transverse arch rib
  asm.addSymmetric('gunmetalDark', createStrut([0, 0.495, -1.42], [0.215, 0.42, -1.42], 0.036, 0.034, 0.02));
  asm.addSymmetric('gunmetalDark', createStrut([0.215, 0.42, -1.42], [0.285, 0.27, -1.42], 0.036, 0.034, 0.02));
  // Aft canopy arch bulkhead seal (merges cleanly into canopySpineFairing)
  asm.addSymmetric('gunmetalDark', createStrut([0, 0.485, -1.04], [0.22, 0.415, -1.04], 0.044, 0.038, 0.02));
  asm.addSymmetric('gunmetalDark', createStrut([0.22, 0.415, -1.04], [0.295, 0.28, -1.04], 0.044, 0.038, 0.02));

  // Sculpted Faceted Canopy Glass (separate semi-transparent physical glass mesh)
  const canopyGlassGeo = trackGeo(
    createLoftedHull(
      [
        {
          z: -2.40,
          points: [
            [0, 0.155],
            [-0.14, 0.135],
            [-0.175, 0.095],
            [0.175, 0.095],
            [0.14, 0.135],
          ],
        },
        {
          z: -1.88,
          points: [
            [0, 0.43],
            [-0.19, 0.365],
            [-0.245, 0.225],
            [0.245, 0.225],
            [0.19, 0.365],
          ],
        },
        {
          z: -1.42,
          points: [
            [0, 0.495],
            [-0.215, 0.42],
            [-0.285, 0.27],
            [0.285, 0.27],
            [0.215, 0.42],
          ],
        },
        {
          z: -1.04,
          points: [
            [0, 0.485],
            [-0.22, 0.415],
            [-0.295, 0.28],
            [0.295, 0.28],
            [0.22, 0.415],
          ],
        },
      ],
      0.5,
      Math.PI * 0.28,
    ),
  );
  const canopyGlassMesh = new THREE.Mesh(canopyGlassGeo, canopyGlassMat);
  canopyGlassMesh.name = 'vanguard-canopy-glass';
  canopyGlassMesh.renderOrder = 2;
  root.add(canopyGlassMesh);

  // =========================================================================
  // 3. DORSAL SPINE MECHANICAL REACTOR CHANNEL & LAYERED CARAPACE ARMOR
  // =========================================================================
  // Recessed dark reactor spine channel floor
  asm.add('darkComposite', new THREE.BoxGeometry(0.46, 0.06, 2.02), [0, 0.32, 1.09]);

  // Glowing cyan dorsal reactor core window at forward end of spine bay + protective rib bars
  asm.add('emissiveCyan', new THREE.BoxGeometry(0.18, 0.038, 0.40), [0, 0.345, 0.36]);
  for (let i = 0; i < 6; i++) {
    asm.add('gunmetalDark', new THREE.BoxGeometry(0.28, 0.025, 0.032), [0, 0.372, 0.18 + i * 0.068]);
  }

  // Twin parallel brushed-titanium dorsal coolant manifold pipes & clamps
  for (const side of [-1, 1] as const) {
    const pipeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.135, 0.355, 0.50),
      new THREE.Vector3(side * 0.165, 0.375, 0.98),
      new THREE.Vector3(side * 0.13, 0.355, 1.52),
      new THREE.Vector3(side * 0.145, 0.305, 2.08),
    ]);
    const pipeGeo = new THREE.TubeGeometry(pipeCurve, 20, 0.025, 8, false);
    asm.add('brushedTitanium', pipeGeo);
  }
  for (let i = 0; i < 6; i++) {
    const zPos = 0.66 + i * 0.25;
    asm.add('gunmetalDark', new THREE.BoxGeometry(0.38, 0.044, 0.072), [0, 0.342, zPos]);
    asm.add('brushedTitanium', new THREE.BoxGeometry(0.24, 0.024, 0.028), [0, 0.378, zPos]);
  }

  // Raised layered dorsal carapace armor plates flanking the spine bay
  const dorsalCarapace = createStealthPlateXZ(
    [
      [0.24, -0.45],
      [0.64, -0.35],
      [0.86, 0.25],
      [0.82, 1.42],
      [0.54, 2.08],
      [0.26, 1.98],
      [0.22, 0.45],
    ],
    0.105,
    0.022,
    0.018,
    0.4,
  );
  asm.addSymmetric('primaryArmor', dorsalCarapace, [0, 0.325, 0], [0, 0, -0.10]);

  // Perforated heat-sink louver pads on rear dorsal shoulders
  for (let i = 0; i < 6; i++) {
    asm.addSymmetric(
      'gunmetalDark',
      new THREE.BoxGeometry(0.28, 0.028, 0.045),
      [0.72, 0.335 - i * 0.008, 0.78 + i * 0.11],
      [0, 0, -0.14],
    );
  }

  // =========================================================================
  // 4. TWIN CIRCULAR TURBINE INTAKES, FAN BLADES & OPEN-FRAME INTAKE SHROUDS
  // =========================================================================
  // Precision-turned brushed titanium intake cowling ring with stepped machined ribs
  const intakeRingProfile = [
    new THREE.Vector2(0.275, -0.16),
    new THREE.Vector2(0.328, -0.18),
    new THREE.Vector2(0.365, -0.12),
    new THREE.Vector2(0.368, -0.02),
    new THREE.Vector2(0.354, 0.02),
    new THREE.Vector2(0.368, 0.08),
    new THREE.Vector2(0.352, 0.22),
    new THREE.Vector2(0.285, 0.22),
    new THREE.Vector2(0.275, -0.16),
  ];
  const intakeRingGeo = new THREE.LatheGeometry(intakeRingProfile, 24);
  intakeRingGeo.rotateX(Math.PI / 2);
  asm.addSymmetric('brushedTitanium', intakeRingGeo, [0.98, -0.02, -0.72]);

  // Dark armored intake cowling collar wrapping the rear-upper rim of the titanium ring
  const intakeCollarGeo = new THREE.CylinderGeometry(0.39, 0.39, 0.24, 20, 1, true, -Math.PI * 0.6, Math.PI * 1.2);
  intakeCollarGeo.rotateX(Math.PI / 2);
  asm.addSymmetric('darkComposite', intakeCollarGeo, [0.98, -0.02, -0.46]);

  // Deep recessed intake compressor barrel & dark inner throat backplate
  const intakeBarrelGeo = new THREE.CylinderGeometry(0.29, 0.26, 0.92, 20, 1, true);
  intakeBarrelGeo.rotateX(Math.PI / 2);
  asm.addSymmetric('gunmetalDark', intakeBarrelGeo, [0.98, -0.02, -0.28]);

  const intakeBackplateGeo = new THREE.CircleGeometry(0.27, 16);
  intakeBackplateGeo.rotateY(Math.PI);
  asm.addSymmetric('darkComposite', intakeBackplateGeo, [0.98, -0.02, -0.34]);

  // Sleek thin horizontal aerodynamic intake splitter vane cutting across intake mouth (reference front-view signature!)
  asm.addSymmetric('gunmetalDark', new THREE.BoxGeometry(0.76, 0.028, 0.28), [0.98, -0.04, -0.82]);
  asm.addSymmetric('brushedTitanium', new THREE.BoxGeometry(0.74, 0.015, 0.05), [0.98, -0.04, -0.95]);

  // Rotating Twin Turbine Compressor Fans (1 single merged mesh per intake)
  const intakeFans: THREE.Group[] = [];
  const fanHubGeo = new THREE.ConeGeometry(0.085, 0.24, 14);
  fanHubGeo.rotateX(-Math.PI / 2);
  fanHubGeo.translate(0, 0, -0.06);
  const fanBladeGeo = new THREE.BoxGeometry(0.23, 0.014, 0.065);

  for (const [ix, iy, iz] of VANGUARD_HARDPOINTS.intakes) {
    const fanGroup = new THREE.Group();
    fanGroup.name = `vanguard-intake-fan-${ix < 0 ? 'L' : 'R'}`;
    fanGroup.position.set(ix, iy, iz + 0.26);

    const bladeCount = 14;
    const bladeParts: THREE.BufferGeometry[] = [normalizeForMerge(fanHubGeo)];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    for (let b = 0; b < bladeCount; b++) {
      const ang = (b / bladeCount) * Math.PI * 2;
      p.set(Math.cos(ang) * 0.145, Math.sin(ang) * 0.145, 0);
      e.set(0.38, 0, ang);
      q.setFromEuler(e);
      m.compose(p, q, s);
      bladeParts.push(normalizeForMerge(fanBladeGeo, m));
    }
    const mergedFan = mergeGeometries(bladeParts, false);
    for (const bp of bladeParts) bp.dispose();
    if (mergedFan) {
      trackGeo(mergedFan);
      fanGroup.add(new THREE.Mesh(mergedFan, brushedTitaniumMat));
    }
    root.add(fanGroup);
    intakeFans.push(fanGroup);
  }
  fanHubGeo.dispose();
  fanBladeGeo.dispose();

  // Open-Frame Forward-Swept Intake Guard Strake (frames OUTSIDE of intake without blocking the turbine mouth!)
  const intakeOuterFrame = createStealthPlateXZ(
    [
      [0.54, -1.86],
      [0.72, -1.68],
      [1.48, -0.94],
      [1.82, -0.52],
      [2.38, 0.04],
      [2.26, 0.56],
      [1.36, 0.34],
      [1.36, -0.58],
      [1.24, -0.96],
      [0.58, -1.58],
    ],
    0.056,
    0.018,
    0.015,
    0.36,
  );
  asm.addSymmetric('primaryArmor', intakeOuterFrame, [0, -0.02, 0]);

  // Compact flush lower intake nacelle belly fairing (tightly hugs bottom of circular intake — zero protruding shelf!)
  const intakeBellyFairing = createStealthPlateXZ(
    [
      [0.64, -0.92],
      [1.32, -0.82],
      [1.36, 0.38],
      [0.62, 0.42],
    ],
    0.055,
    0.016,
    0.014,
    0.42,
  );
  asm.addSymmetric('darkComposite', intakeBellyFairing, [0, -0.34, 0]);

  // Brushed titanium leading-edge reinforcement cuff along forward wing-shoulder strake
  const shoulderCuff = createStealthPlateXZ(
    [
      [1.48, -0.86],
      [2.42, 0.04],
      [2.32, 0.22],
      [1.44, -0.62],
    ],
    0.068,
    0.012,
    0.012,
    0.5,
  );
  asm.addSymmetric('brushedTitanium', shoulderCuff, [0, -0.01, 0]);

  // Subtle shoulder corner white-cyan strobe lens
  asm.addSymmetric('emissiveNavWhite', new THREE.BoxGeometry(0.12, 0.04, 0.20), [2.35, -0.01, 0.08], [0, -0.58, 0]);

  // =========================================================================
  // 5. INTEGRATED TWIN PULSE CANNONS — EXACT MUZZLE AT [±1.48, -0.14, -1.65]
  // =========================================================================
  const cx = 1.48;
  const cy = -0.14;

  // 5a. Armored Wing-Shoulder Weapon Cradle & Mount Pylon (anchors solidly into wing shoulder)
  asm.addSymmetric('gunmetalDark', new THREE.BoxGeometry(0.24, 0.18, 0.64), [cx, cy + 0.04, -0.04]);
  asm.addSymmetric('gunmetalDark', new THREE.BoxGeometry(0.20, 0.12, 0.56), [cx - 0.08, cy + 0.12, -0.10]);
  const cannonHood = createStealthPlateXZ(
    [
      [cx - 0.15, -0.64],
      [cx + 0.17, -0.54],
      [cx + 0.22, 0.26],
      [cx - 0.17, 0.26],
    ],
    0.048,
    0.014,
    0.012,
    0.5,
  );
  asm.addSymmetric('primaryArmor', cannonHood, [0, cy + 0.14, 0]);

  // Twin brushed-titanium recoil damper cylinders flanking the receiver
  const damperGeo = new THREE.CylinderGeometry(0.023, 0.023, 0.42, 8);
  damperGeo.rotateX(Math.PI / 2);
  asm.addSymmetric('brushedTitanium', damperGeo, [cx + 0.105, cy + 0.03, -0.44], undefined, undefined, false);
  asm.addSymmetric('brushedTitanium', damperGeo, [cx - 0.095, cy + 0.03, -0.44]);

  // 5b. Chamfered Pulse Capacitor Receiver Housing (z = -0.28 to -0.86)
  const receiverGeo = new THREE.CylinderGeometry(0.102, 0.122, 0.60, 8);
  receiverGeo.rotateX(Math.PI / 2);
  receiverGeo.rotateZ(Math.PI / 8);
  asm.addSymmetric('gunmetalDark', receiverGeo, [cx, cy, -0.56]);

  for (let i = 0; i < 4; i++) {
    asm.addSymmetric('brushedTitanium', new THREE.BoxGeometry(0.21, 0.038, 0.03), [cx, cy, -0.38 - i * 0.12]);
  }

  // 5c. Twin-Rail Electromagnetic Accelerator Barrel Shroud (z = -0.82 to -1.52)
  const innerBarrelGeo = new THREE.CylinderGeometry(0.044, 0.052, 0.84, 12);
  innerBarrelGeo.rotateX(Math.PI / 2);
  asm.addSymmetric('gunmetalDark', innerBarrelGeo, [cx, cy, -1.21]);

  asm.addSymmetric('brushedTitanium', new THREE.BoxGeometry(0.070, 0.030, 0.78), [cx, cy + 0.060, -1.16]);
  asm.addSymmetric('brushedTitanium', new THREE.BoxGeometry(0.070, 0.030, 0.78), [cx, cy - 0.060, -1.16]);

  const collarGeo = new THREE.CylinderGeometry(0.070, 0.070, 0.044, 10);
  collarGeo.rotateX(Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    asm.addSymmetric('gunmetalDark', collarGeo, [cx, cy, -0.88 - i * 0.18], undefined, undefined, i === 3);
  }

  // Integrated electric-cyan plasma energy conduit rails
  asm.addSymmetric('emissiveCyan', new THREE.BoxGeometry(0.094, 0.016, 0.72), [cx, cy, -1.14]);
  asm.addSymmetric('emissiveCyan', new THREE.BoxGeometry(0.022, 0.020, 0.42), [cx, cy + 0.088, -0.62]);

  // 5d. Precision Fluted Muzzle Brake & Plasma Aperture — terminates at EXACT z = -1.65!
  const muzzleBrakeProfile = [
    new THREE.Vector2(0.036, -0.08),
    new THREE.Vector2(0.068, -0.08),
    new THREE.Vector2(0.074, -0.03),
    new THREE.Vector2(0.066, 0.06),
    new THREE.Vector2(0.056, 0.08),
    new THREE.Vector2(0.036, 0.08),
  ];
  const muzzleBrakeGeo = new THREE.LatheGeometry(muzzleBrakeProfile, 12);
  muzzleBrakeGeo.rotateX(Math.PI / 2);
  asm.addSymmetric('brushedTitanium', muzzleBrakeGeo, [cx, cy, -1.57]);

  const muzzleGlowRing = new THREE.TorusGeometry(0.038, 0.01, 6, 12);
  asm.addSymmetric('emissiveCyan', muzzleGlowRing, [cx, cy, -1.638]);

  // =========================================================================
  // 6. SEAMLESS LAYERED SWEPT-BACK ANHEDRAL WINGS & ELEVONS (x = ±3.98)
  // =========================================================================
  const wingPivotX = 1.80;
  const anhedralSlope = -0.115; // smooth downward droop outboard of wing shoulder (zero step cliff!)
  const anhedralAngle = Math.atan(anhedralSlope);

  // 6a. Broad Diamond Inner Wing Root Armor Deck (flush with intake outer shroud & outer wing!)
  const innerWingDeck = createStealthPlateXZ(
    [
      [1.06, -0.25],
      [2.36, 0.06],
      [2.24, 0.92],
      [1.76, 1.48],
      [1.02, 1.38],
    ],
    0.105,
    0.024,
    0.018,
    0.34,
  );
  asm.addSymmetric('primaryArmor', innerWingDeck, [0, -0.01, 0]);

  // Dark recessed stealth triangular inlay on inner wing root
  const innerWingInlay = createStealthPlateXZ(
    [
      [1.22, 0.14],
      [2.06, 0.24],
      [1.94, 0.84],
      [1.64, 1.24],
      [1.18, 1.16],
    ],
    0.032,
    0.01,
    0.008,
    0.45,
  );
  asm.addSymmetric('darkComposite', innerWingInlay, [0, 0.048, 0]);

  // Crisp thin painted squadron azure-blue chevron trim tracing the inner wing root
  const innerWingChevron = createStealthPlateXZ(
    [
      [1.18, 0.06],
      [2.18, 0.18],
      [2.15, 0.24],
      [1.22, 0.12],
    ],
    0.02,
    0.004,
    0.004,
    0.5,
  );
  asm.addSymmetric('squadronAccent', innerWingChevron, [0, 0.066, 0]);

  // 6b. Swept-Back High-Speed Outer Interceptor Wings (pivoted flush at wingPivotX = 1.80!)
  const outerWingMain = createSlopedPlateXZ(
    [
      [1.70, 0.34],
      [3.92, 2.02],
      [3.78, 2.34],
      [3.40, 2.28],
      [1.68, 1.26],
    ],
    0.078,
    0.02,
    0.016,
    wingPivotX,
    anhedralSlope,
    0.34,
  );
  asm.addSymmetric('darkComposite', outerWingMain, [0, -0.01, 0]);

  // Layered stepped upper armor skin panel on outer wing (seamless blend into inner wing deck!)
  const outerWingUpperArmor = createSlopedPlateXZ(
    [
      [1.82, 0.46],
      [3.68, 1.88],
      [3.52, 2.12],
      [1.82, 1.06],
    ],
    0.05,
    0.014,
    0.012,
    wingPivotX,
    anhedralSlope,
    0.38,
  );
  asm.addSymmetric('primaryArmor', outerWingUpperArmor, [0, 0.022, 0]);

  // Brushed-titanium armored wing leading-edge spar cuff
  const outerWingLeadingCuff = createSlopedPlateXZ(
    [
      [1.76, 0.30],
      [3.94, 1.98],
      [3.88, 2.07],
      [1.76, 0.43],
    ],
    0.062,
    0.012,
    0.012,
    wingPivotX,
    anhedralSlope,
    0.5,
  );
  asm.addSymmetric('brushedTitanium', outerWingLeadingCuff, [0, -0.005, 0]);

  // Sleek thin painted squadron accent stripe running down the outer wing
  const outerWingStripe = createSlopedPlateXZ(
    [
      [1.92, 0.74],
      [3.58, 1.98],
      [3.53, 2.04],
      [1.92, 0.82],
    ],
    0.018,
    0.003,
    0.003,
    wingPivotX,
    anhedralSlope,
    0.5,
  );
  asm.addSymmetric('squadronAccent', outerWingStripe, [0, 0.056, 0]);

  // Under-wing structural actuator fairings
  for (let i = 0; i < 2; i++) {
    const wx = 2.42 + i * 0.68;
    const wz = 1.24 + i * 0.50;
    const wy = -0.06 + (wx - wingPivotX) * anhedralSlope;
    asm.addSymmetric('gunmetalDark', new THREE.BoxGeometry(0.11, 0.075, 0.42), [wx, wy, wz], [0, -0.52, anhedralAngle]);
  }

  // Sculpted Wingtip Sensor / Navigation Light Pods (x = ±3.94, z = +2.18)
  const tipY = -0.01 + (3.92 - wingPivotX) * anhedralSlope;
  asm.addSymmetric('gunmetalDark', new THREE.BoxGeometry(0.14, 0.072, 0.44), [3.90, tipY, 2.18], [0, -0.22, anhedralAngle]);
  asm.addSymmetric('emissiveCyan', new THREE.BoxGeometry(0.075, 0.038, 0.32), [3.95, tipY, 2.18], [0, -0.22, anhedralAngle]);

  // 6c. Dynamic Articulated Trailing-Edge Elevons (live flight control deflection!)
  const elevonPivots: Array<{ pivot: THREE.Group; side: -1 | 1 }> = [];
  const elevonGeo = trackGeo(new THREE.BoxGeometry(1.18, 0.034, 0.23));
  for (const side of [-1, 1] as const) {
    const pivot = new THREE.Group();
    pivot.name = `vanguard-elevon-${side < 0 ? 'L' : 'R'}`;
    const ex = side * 2.66;
    const ey = -0.015 + (2.66 - wingPivotX) * anhedralSlope;
    const ez = 1.62;
    pivot.position.set(ex, ey, ez);
    pivot.rotation.set(0, side * -0.54, side * anhedralAngle);

    const blade = new THREE.Mesh(elevonGeo, gunmetalDarkMat);
    blade.position.set(0, 0, 0.115);
    blade.castShadow = true;
    blade.receiveShadow = true;
    pivot.add(blade);
    root.add(pivot);
    elevonPivots.push({ pivot, side });
  }

  // 6d. Aft Stub Horizontal Stabilizer Strakes (tucked cleanly behind wing root notch)
  const aftStubFin = createStealthPlateXZ(
    [
      [0.98, 1.56],
      [1.64, 1.82],
      [1.54, 2.26],
      [0.96, 2.18],
    ],
    0.056,
    0.014,
    0.012,
    0.45,
  );
  asm.addSymmetric('darkComposite', aftStubFin, [0, -0.06, 0]);

  const aftStubAccent = createStealthPlateXZ(
    [
      [1.56, 1.82],
      [1.66, 1.84],
      [1.56, 2.28],
      [1.46, 2.24],
    ],
    0.060,
    0.008,
    0.008,
    0.5,
  );
  asm.addSymmetric('squadronAccent', aftStubAccent, [0, -0.06, 0]);

  // =========================================================================
  // 7. TWIN S-DUCT ENGINE NACELLES, SLEEK CANTED V-TAILS & RECTANGULAR THRUSTERS
  // =========================================================================
  const makeNacelleSection = (
    z: number,
    cxNac: number,
    cyNac: number,
    hw: number,
    hhTop: number,
    hhBot: number,
  ): LoftSection => ({
    z,
    points: [
      [cxNac, cyNac + hhTop + 0.02],
      [cxNac - hw * 0.72, cyNac + hhTop],
      [cxNac - hw, cyNac + hhTop * 0.35],
      [cxNac - hw, cyNac - hhBot * 0.45],
      [cxNac - hw * 0.72, cyNac - hhBot],
      [cxNac, cyNac - hhBot - 0.02],
      [cxNac + hw * 0.72, cyNac - hhBot],
      [cxNac + hw, cyNac - hhBot * 0.45],
      [cxNac + hw, cyNac + hhTop * 0.35],
      [cxNac + hw * 0.72, cyNac + hhTop],
    ],
  });

  const rightNacelleGeo = createLoftedHull(
    [
      makeNacelleSection(-0.44, 0.98, -0.02, 0.38, 0.33, 0.32),
      makeNacelleSection(0.28, 0.88, 0.01, 0.42, 0.33, 0.31),
      makeNacelleSection(1.18, 0.74, 0.035, 0.41, 0.28, 0.27),
      makeNacelleSection(2.04, 0.66, 0.05, 0.39, 0.23, 0.21),
      makeNacelleSection(2.58, 0.64, 0.05, 0.36, 0.18, 0.17),
    ],
    0.42,
    Math.PI * 0.22,
  );
  asm.addSymmetric('primaryArmor', rightNacelleGeo);

  // Outer nacelle brushed-titanium auxiliary coolant pods & side fairings
  const sidePodGeo = new THREE.CylinderGeometry(0.058, 0.058, 0.72, 10);
  sidePodGeo.rotateX(Math.PI / 2);
  asm.addSymmetric('brushedTitanium', sidePodGeo, [1.03, 0.15, 1.56]);
  asm.addSymmetric('gunmetalDark', new THREE.BoxGeometry(0.10, 0.13, 1.15), [1.01, 0.05, 1.62]);

  // 7a. Sleek Low-Profile Long-Chord Canted V-Tail Vertical Stabilizers (matching reference side/3/4 profile!)
  const vTailCant = -0.66; // ~38 deg aggressive stealth cant
  const vTailMain = createStealthFinZY(
    [
      [0.32, 0.0],
      [1.42, 0.10],
      [2.08, 0.64],
      [2.82, 0.60],
      [3.04, 0.34],
      [2.64, 0.02],
    ],
    0.068,
    0.016,
    0.014,
    0.4,
  );
  asm.addSymmetric('darkComposite', vTailMain, [0.74, 0.22, 0], [0, 0, vTailCant]);

  const vTailArmor = createStealthFinZY(
    [
      [1.24, 0.11],
      [2.08, 0.57],
      [2.74, 0.53],
      [2.56, 0.10],
    ],
    0.032,
    0.009,
    0.008,
    0.45,
  );
  asm.addSymmetric('primaryArmor', vTailArmor, [0.77, 0.24, 0], [0, 0, vTailCant]);

  // Crisp painted squadron azure-blue dorsal crest stripe along V-tail upper spine
  const vTailStripe = createStealthFinZY(
    [
      [1.40, 0.11],
      [2.08, 0.65],
      [2.81, 0.61],
      [2.78, 0.54],
      [2.10, 0.58],
      [1.48, 0.11],
    ],
    0.074,
    0.007,
    0.007,
    0.5,
  );
  asm.addSymmetric('squadronAccent', vTailStripe, [0.74, 0.22, 0], [0, 0, vTailCant]);

  // Crisp illuminated tailtip navigation strobe edge at aft peak of V-tails
  const vTailStrobe = createStealthFinZY(
    [
      [2.56, 0.625],
      [2.84, 0.60],
      [2.87, 0.55],
      [2.56, 0.585],
    ],
    0.08,
    0.004,
    0.004,
    0.5,
  );
  asm.addSymmetric('emissiveNavWhite', vTailStrobe, [0.74, 0.22, 0], [0, 0, vTailCant]);

  // 7b. Twin Rectangular Vectored Plasma Thruster Nozzles
  const thrusterPaddles: Array<{ upper: THREE.Mesh; lower: THREE.Mesh }> = [];
  const exhaustMeshes: THREE.Mesh[] = [];
  const glowSprites: THREE.Sprite[] = [];

  const paddleGeo = trackGeo(new THREE.BoxGeometry(0.62, 0.04, 0.34));
  // Compact, smooth-fading elliptical plume cone (extends dramatically on boost without needle artifacts)
  const plumeGeo = trackGeo(new THREE.ConeGeometry(0.5, 2.5, 20, 1, true));
  plumeGeo.rotateX(Math.PI / 2);
  plumeGeo.translate(0, 0, 1.25);

  for (const [tx, ty, tz] of VANGUARD_HARDPOINTS.thrusters) {
    // Outer heavy dark-gunmetal rectangular thruster shroud frame
    asm.add('gunmetalDark', new THREE.BoxGeometry(0.72, 0.058, 0.38), [tx, ty + 0.142, tz - 0.04]);
    asm.add('gunmetalDark', new THREE.BoxGeometry(0.72, 0.058, 0.38), [tx, ty - 0.142, tz - 0.04]);
    asm.add('gunmetalDark', new THREE.BoxGeometry(0.074, 0.31, 0.42), [tx - 0.33, ty, tz - 0.02]);
    asm.add('gunmetalDark', new THREE.BoxGeometry(0.074, 0.31, 0.42), [tx + 0.33, ty, tz - 0.02]);

    asm.add('brushedTitanium', new THREE.BoxGeometry(0.044, 0.21, 0.30), [tx - 0.364, ty, tz + 0.03]);
    asm.add('brushedTitanium', new THREE.BoxGeometry(0.044, 0.21, 0.30), [tx + 0.364, ty, tz + 0.03]);

    // 9 vertical exhaust louver vanes recessed inside rectangular nozzle
    for (let v = -4; v <= 4; v++) {
      asm.add('gunmetalDark', new THREE.BoxGeometry(0.018, 0.20, 0.12), [tx + v * 0.064, ty, tz + 0.02]);
    }
    asm.add('gunmetalDark', new THREE.BoxGeometry(0.58, 0.02, 0.10), [tx, ty, tz + 0.03]);

    const coreMesh = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(0.58, 0.21)),
      thrusterCoreMat,
    );
    coreMesh.position.set(tx, ty, tz - 0.05);
    root.add(coreMesh);

    const upperPivot = new THREE.Group();
    upperPivot.position.set(tx, ty + 0.138, tz + 0.06);
    const upperPaddle = new THREE.Mesh(paddleGeo, brushedTitaniumMat);
    upperPaddle.position.set(0, 0, 0.12);
    upperPaddle.castShadow = true;
    upperPivot.add(upperPaddle);
    root.add(upperPivot);

    const lowerPivot = new THREE.Group();
    lowerPivot.position.set(tx, ty - 0.138, tz + 0.06);
    const lowerPaddle = new THREE.Mesh(paddleGeo, brushedTitaniumMat);
    lowerPaddle.position.set(0, 0, 0.12);
    lowerPaddle.castShadow = true;
    lowerPivot.add(lowerPaddle);
    root.add(lowerPivot);
    thrusterPaddles.push({ upper: upperPaddle, lower: lowerPaddle });

    const plume = new THREE.Mesh(plumeGeo, exhaustMat);
    plume.position.set(tx, ty, tz + 0.04);
    plume.scale.set(0.62, 0.25, 0.72);
    plume.renderOrder = 10;
    root.add(plume);
    exhaustMeshes.push(plume);

    const sprite = new THREE.Sprite(glowSpriteMat);
    sprite.position.set(tx, ty, tz + 0.32);
    sprite.scale.set(1.48, 0.88, 1);
    sprite.renderOrder = 11;
    root.add(sprite);
    glowSprites.push(sprite);
  }

  // Twin lower auxiliary maneuvering/brake vent pods underneath main thrusters
  asm.addSymmetric('darkComposite', new THREE.BoxGeometry(0.46, 0.15, 0.92), [0.64, -0.22, 1.88]);
  asm.addSymmetric('gunmetalDark', new THREE.BoxGeometry(0.38, 0.105, 0.14), [0.64, -0.22, 2.34]);
  asm.addSymmetric('brushedTitanium', new THREE.BoxGeometry(0.32, 0.03, 0.08), [0.64, -0.268, 2.32]);
  asm.addSymmetric('emissiveCyan', new THREE.BoxGeometry(0.24, 0.026, 0.04), [0.64, -0.22, 2.40]);

  // Central rear maintenance bulkhead louvers between the two main thruster nozzles
  asm.add('gunmetalDark', new THREE.BoxGeometry(0.44, 0.24, 0.14), [0, -0.02, 2.42]);
  for (let r = 0; r < 4; r++) {
    asm.add('brushedTitanium', new THREE.BoxGeometry(0.34, 0.018, 0.06), [0, 0.06 - r * 0.045, 2.48]);
  }
  asm.add('emissiveCyan', new THREE.BoxGeometry(0.18, 0.024, 0.04), [0, 0.14, 2.46]);

  // =========================================================================
  // 8. DETAILED VENTRAL BELLY, MISSILE BAY & LANDING GEAR DOORS (Bottom View)
  // =========================================================================
  asm.add('darkComposite', new THREE.BoxGeometry(0.34, 0.11, 1.12), [0, -0.32, -2.36]);
  asm.add('brushedTitanium', new THREE.BoxGeometry(0.14, 0.06, 0.28), [0, -0.36, -2.76]);
  asm.add('emissiveCyan', new THREE.BoxGeometry(0.08, 0.024, 0.06), [0, -0.36, -2.90]);

  const ventralBayPlate = createStealthPlateXZ(
    [
      [0.44, -0.95],
      [0.52, -0.45],
      [0.52, 1.15],
      [0.36, 1.56],
      [-0.36, 1.56],
      [-0.52, 1.15],
      [-0.52, -0.45],
      [-0.44, -0.95],
    ],
    0.09,
    0.02,
    0.016,
    0.42,
  );
  asm.add('darkComposite', ventralBayPlate, [0, -0.39, 0]);

  asm.add('brushedTitanium', new THREE.BoxGeometry(0.075, 0.035, 2.05), [0, -0.44, 0.28]);
  asm.addSymmetric('gunmetalDark', new THREE.BoxGeometry(0.16, 0.04, 0.56), [0.22, -0.435, -0.58]);
  for (let i = 0; i < 6; i++) {
    asm.add('gunmetalDark', new THREE.BoxGeometry(0.56, 0.028, 0.055), [0, -0.442, 0.22 + i * 0.14]);
  }

  // Twin ventral nacelle landing-gear pods & docking skid rails
  asm.addSymmetric('gunmetalDark', new THREE.BoxGeometry(0.38, 0.12, 1.38), [0.68, -0.32, 0.62]);
  asm.addSymmetric('brushedTitanium', new THREE.BoxGeometry(0.24, 0.044, 0.42), [0.68, -0.38, 0.42]);
  asm.addSymmetric('squadronAccent', new THREE.BoxGeometry(0.22, 0.024, 0.24), [0.68, -0.38, 1.02]);

  // Finalize & merge all static material buckets into minimal draw calls
  asm.finalize(
    root,
    {
      primaryArmor: primaryArmorMat,
      darkComposite: darkCompositeMat,
      brushedTitanium: brushedTitaniumMat,
      gunmetalDark: gunmetalDarkMat,
      squadronAccent: squadronAccentMat,
      emissiveCyan: emissiveCyanMat,
      emissiveNavWhite: emissiveNavWhiteMat,
      cockpitHud: cockpitHudMat,
    },
    geometries,
  );

  const engineLight = new THREE.PointLight(ship.colors.engineGlow, 3.0, 15, 1.8);
  engineLight.position.set(0, 0.25, 3.35);
  root.add(engineLight);

  let animTime = 0;
  let highDetailEnabled = true;
  let smoothPitch = 0;
  let smoothRoll = 0;

  return {
    group: root,
    setDetailLevel: (highDetail: boolean) => {
      if (highDetailEnabled === highDetail) return;
      highDetailEnabled = highDetail;
      engineLight.visible = highDetail;
      for (let i = 0; i < glowSprites.length; i++) {
        glowSprites[i].visible = highDetail;
      }
    },
    updateVisuals: (dt, speedRatio, boostIntensity, _yawInput, pitchInput, rollInput) => {
      animTime += dt;
      const clampedSpeed = THREE.MathUtils.clamp(speedRatio, 0, 1.6);
      const intensity = THREE.MathUtils.clamp(
        0.28 + clampedSpeed * 0.44 + boostIntensity * 0.9,
        0.2,
        1.65,
      );

      exhaustMat.uniforms.uTime.value = animTime;
      exhaustMat.uniforms.uIntensity.value = intensity;

      thrusterCoreMat.emissiveIntensity = 1.9 + clampedSpeed * 0.95 + boostIntensity * 2.5;
      emissiveCyanMat.emissiveIntensity = 1.2 + boostIntensity * 1.15;

      if (highDetailEnabled) {
        engineLight.intensity = 2.2 + clampedSpeed * 1.5 + boostIntensity * 4.8;
      }

      const plumeLen =
        0.48 + clampedSpeed * 0.56 + boostIntensity * 1.48 + Math.sin(animTime * 46) * 0.04;
      const plumeWidth = 0.62 * (1.0 + boostIntensity * 0.22);
      const plumeHeight = 0.25 * (1.0 + boostIntensity * 0.34);

      for (let i = 0; i < exhaustMeshes.length; i++) {
        exhaustMeshes[i].scale.set(plumeWidth, plumeHeight, plumeLen);
      }

      if (highDetailEnabled) {
        const sx = 1.42 + clampedSpeed * 0.46 + boostIntensity * 1.1;
        const sy = 0.84 + clampedSpeed * 0.24 + boostIntensity * 0.68;
        glowSpriteMat.opacity = THREE.MathUtils.clamp(0.4 + boostIntensity * 0.48, 0.36, 0.9);
        for (let i = 0; i < glowSprites.length; i++) {
          glowSprites[i].scale.set(sx, sy, 1);
        }
      }

      // Spin twin turbine intake compressor fans smoothly proportional to thrust
      const fanSpeed = 5.5 + clampedSpeed * 14.0 + boostIntensity * 18.0;
      intakeFans[0].rotation.z += dt * fanSpeed;
      intakeFans[1].rotation.z -= dt * fanSpeed;

      // Exponentially damped flight surface & thrust-vectoring paddle deflection
      smoothPitch = THREE.MathUtils.damp(
        smoothPitch,
        THREE.MathUtils.clamp(pitchInput, -1, 1),
        10,
        dt,
      );
      smoothRoll = THREE.MathUtils.damp(
        smoothRoll,
        THREE.MathUtils.clamp(rollInput, -1, 1),
        10,
        dt,
      );

      for (let i = 0; i < elevonPivots.length; i++) {
        const { pivot, side } = elevonPivots[i];
        const deflection = THREE.MathUtils.clamp(
          smoothPitch * 0.24 + side * smoothRoll * 0.26,
          -0.36,
          0.36,
        );
        pivot.children[0].rotation.x = deflection;
      }

      const openAngle = 0.04 + boostIntensity * 0.14;
      const vecPitch = smoothPitch * 0.12;
      for (let i = 0; i < thrusterPaddles.length; i++) {
        thrusterPaddles[i].upper.rotation.x = openAngle + vecPitch;
        thrusterPaddles[i].lower.rotation.x = -openAngle + vecPitch;
      }
    },
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      AssetManager.releaseVanguardTextures(texRes.key);
      AssetManager.releaseGlowSprite();
    },
  };
}
