import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShieldState } from '../types/combat';

const VERTEX = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vPos;
  varying vec3 vUv; // x,y: hull-relative -1..1 across width/height, z: 0 tail .. 1 nose
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  uniform vec3 uCenter;
  uniform vec3 uHalf;
  uniform float uInflate;
  void main() {
    vec3 rel = (position - uCenter) / uHalf;
    vUv = vec3(rel.xy, rel.z * 0.5 + 0.5);
    vLocal = normalize(position);
    vPos = position;
    vec4 mvPosition = modelViewMatrix * vec4(position + normal * uInflate, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uStrength;
  uniform float uRecharge;
  uniform float uCollapse;
  uniform float uSeed;
  uniform vec3 uColor;
  uniform vec3 uImpactPos[MAX_IMPACTS];
  uniform vec2 uImpact[MAX_IMPACTS]; // x = age seconds (<0 inactive), y = amplitude
  varying vec3 vPos;
  varying vec3 vUv;
  varying vec3 vLocal;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    // Surface coordinates follow the ship: longitude runs along its length, latitude wraps its cross-section
    // (mirrored top/bottom so there is no seam). Sphere-style lat/long collapses on a flattened hull.
    float longitude = (vUv.z * 2.0 - 1.0) * 3.14159265;
    float latitude = vUv.x * 0.95 + vUv.y * 0.3;
    float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float rim = pow(1.0 - facing, 3.1);

    // A few uneven, traveling energy streams give the shell motion without a grid or cell pattern.
    float streamPathA = 0.28 * sin(longitude * 2.0 - uTime * 0.48 + uSeed)
      + 0.11 * sin(longitude * 4.3 + uTime * 0.74 + uSeed * 1.7);
    float streamPathB = -0.42 + 0.17 * sin(longitude * 1.55 + uTime * 0.37 + uSeed * 2.1);
    float streamPathC = 0.56 * sin(longitude * 1.18 - uTime * 0.61 + uSeed * 0.7);
    float streamA = 1.0 - smoothstep(0.0, 0.05, abs(latitude - streamPathA));
    float streamB = 1.0 - smoothstep(0.0, 0.04, abs(latitude - streamPathB));
    float streamC = 1.0 - smoothstep(0.0, 0.04, abs(latitude - streamPathC));

    // Narrow arcs appear intermittently and travel around the barrier, especially when energy is low.
    float arcWave = sin(longitude * 8.0 + sin(latitude * 5.0 + uTime * 0.9 + uSeed) * 1.6
      - uTime * (1.15 + (1.0 - uStrength) * 1.2) + uSeed * 3.0);
    float arcBand = 1.0 - smoothstep(0.0, 0.045, abs(latitude - 0.2 * arcWave));
    float arcPulse = pow(max(0.0, sin(uTime * (1.8 + (1.0 - uStrength) * 4.0) + longitude * 5.0 + uSeed)), 14.0);
    float energyFront = pow(max(0.0, sin(longitude * 2.5 - uTime * 0.43 + uSeed)
      * cos(latitude * 3.2 + uTime * 0.52)), 7.0);

    // Precise energy packets travelling tail-to-nose along the hull.
    float travelPos = fract(vUv.z - uTime * 0.22 + uSeed * 0.13);
    float travel = exp(-pow((travelPos - 0.5) / 0.035, 2.0)) * (0.35 + 0.65 * abs(sin(vUv.x * 9.0)));

    float unstable = 1.0 - smoothstep(0.16, 0.48, uStrength);
    float arcPath = 0.22 * sin(longitude * 5.2 - uTime * 1.7 + uSeed)
      + 0.13 * sin(longitude * 10.4 + uTime * 1.15 + uSeed * 1.8);
    float arcStroke = 1.0 - smoothstep(0.0, 0.04, abs(latitude - arcPath));
    float arcGateWave = sin(longitude * 3.1 + uTime * (1.0 + unstable * 1.8) + uSeed * 2.6);
    float arcGate = smoothstep(0.78 - unstable * 0.3, 0.94 - unstable * 0.2, arcGateWave);
    float lightning = arcStroke * arcGate * (0.34 + unstable * 0.66)
      * (0.42 + 0.58 * pow(max(0.0, sin(uTime * 7.0 + longitude * 13.0 + uSeed)), 5.0));
    float flicker = 1.0 - unstable * (0.26 * step(0.83, fract(sin(floor(uTime * 18.0 + uSeed * 9.0) * 17.17) * 43758.5)));
    float pulse = 0.9 + 0.1 * sin(uTime * (1.4 + unstable * 4.0) + longitude * 2.0 + uSeed);

    // During regeneration, a visible energy front sweeps across the envelope as capacity returns.
    float polarProgress = vUv.z;
    float forming = mix(1.0, smoothstep(polarProgress - 0.11, polarProgress + 0.08, uStrength), uRecharge);

    // Localized impact: bright flash at the hit plus an expanding ring that fades quickly.
    float impactGlow = 0.0;
    float impactRing = 0.0;
    for (int i = 0; i < MAX_IMPACTS; i++) {
      float age = uImpact[i].x;
      if (age < 0.0 || age > IMPACT_LIFE) continue;
      float d = distance(vPos, uImpactPos[i]);
      float life = 1.0 - age / IMPACT_LIFE;
      float r = 0.12 + age * 3.4;
      float w = 0.1 + age * 0.22;
      impactRing += exp(-pow((d - r) / w, 2.0)) * life * life * uImpact[i].y;
      impactGlow += exp(-d * d / 0.16) * exp(-age * 9.0) * uImpact[i].y;
    }
    impactRing = min(impactRing, 1.5);
    impactGlow = min(impactGlow, 1.5);

    // Regeneration scan line marks where capacity is being restored.
    float rechargeFront = uRecharge * (1.0 - smoothstep(0.0, 0.03, abs(polarProgress - uStrength))) * step(0.005, uStrength);

    float lowBoost = 1.0 - uStrength; // extra visibility only as energy drains
    float body = 0.05 + rim * 0.34 + lowBoost * (0.04 + rim * 0.16);
    float energyLines = streamA * 0.42 + streamB * 0.3 + streamC * 0.34 + travel * 0.3
      + arcBand * arcPulse * (0.27 + unstable * 0.65) + energyFront * 0.07 + lightning * 0.48;
    float alpha = (body + energyLines + arcPulse * 0.12) * (0.8 + 0.2 * uStrength) * (1.0 + 0.5 * (1.0 - uStrength)) * pulse * flicker * forming;
    alpha += impactRing * 0.5 + impactGlow * 0.7 + rechargeFront * 0.35;
    alpha *= (1.0 - uCollapse) * mix(1.0, 1.4, uRecharge);

    vec3 blueWhite = vec3(0.78, 0.94, 1.0);
    // Low energy drifts slightly toward a warning tint; the base hue is otherwise preserved.
    vec3 baseColor = mix(uColor, vec3(1.0, 0.62, 0.32), unstable * 0.4);
    vec3 energyColor = mix(baseColor, blueWhite, clamp(rim * 0.72 + streamA * 0.65 + streamC * 0.65 + arcPulse + lightning, 0.0, 1.0));
    energyColor = mix(energyColor, blueWhite, clamp(impactGlow + impactRing * 0.6 + rechargeFront, 0.0, 1.0));
    energyColor *= 1.0 + impactGlow * 2.2 + impactRing * 1.6 + rechargeFront * 1.5;
    energyColor *= 0.9 + lowBoost * 0.35 + rim * (1.2 + lowBoost * 0.4) + streamA * 1.8 + streamB * 1.2 + streamC * 1.5 + energyFront * 1.1 + arcPulse * 2.8 + lightning * 3.0;
    gl_FragColor = vec4(energyColor, alpha);
  }
`;

const COLLAPSE_SECONDS = 0.52;
const MAX_IMPACTS = 4;
const IMPACT_LIFE = 0.85;
const DEFINES = `#define MAX_IMPACTS ${MAX_IMPACTS}\n#define IMPACT_LIFE ${IMPACT_LIFE.toFixed(2)}\n`;

interface PendingImpact { x: number; y: number; z: number; amp: number }
const pendingImpacts = new Map<string, PendingImpact[]>();
const _impactLocal = new THREE.Vector3();

/** Record a shield hit (world-space point) for the entity that owns a shield mesh. Cheap; consumed next frame. */
export function queueShieldImpact(entityId: string, worldPoint: THREE.Vector3, amplitude = 1): void {
  let list = pendingImpacts.get(entityId);
  if (!list) { list = []; pendingImpacts.set(entityId, list); }
  if (list.length >= MAX_IMPACTS) list.shift();
  list.push({ x: worldPoint.x, y: worldPoint.y, z: worldPoint.z, amp: amplitude });
}

/** Move queued world-space hits for this entity into the shield's ring buffer, in shield-local space. */
export function consumeShieldImpacts(entityId: string, mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>): void {
  const list = pendingImpacts.get(entityId);
  if (!list || list.length === 0) return;
  const field = mesh as ShieldFieldMesh;
  mesh.updateWorldMatrix(true, false);
  const u = mesh.material.uniforms;
  for (const hit of list) {
    let slot = (field.userData.impactCursor ?? 0) % MAX_IMPACTS;
    field.userData.impactCursor = slot + 1;
    _impactLocal.set(hit.x, hit.y, hit.z);
    mesh.worldToLocal(_impactLocal);
    (u.uImpactPos.value as THREE.Vector3[])[slot].copy(_impactLocal);
    (u.uImpact.value as THREE.Vector2[])[slot].set(0, hit.amp);
  }
  list.length = 0;
}

/** Drop any queued hits (e.g. on mission restart) so stale impacts never appear. */
export function clearShieldImpacts(): void {
  pendingImpacts.clear();
}

export interface ShieldSurfaceHit {
  /** World-space point on the un-inflated shield skin (use for the shader ripple). */
  surface: THREE.Vector3;
  /** World-space point on the rendered (inflated) outer skin (use for billboarded VFX). */
  position: THREE.Vector3;
  /** Unit outward surface normal in world space. */
  normal: THREE.Vector3;
}

export function createShieldSurfaceHit(): ShieldSurfaceHit {
  return { surface: new THREE.Vector3(), position: new THREE.Vector3(), normal: new THREE.Vector3() };
}

const PROBE_DISTANCE = 40;
const _probeRaycaster = new THREE.Raycaster();
const _probeHits: THREE.Intersection[] = [];
const _probeOrigin = new THREE.Vector3();
const _probeDir = new THREE.Vector3();
const _probeCenter = new THREE.Vector3();
const _probeNormal = new THREE.Vector3();

function castAgainstShield(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  out: ShieldSurfaceHit,
): boolean {
  _probeRaycaster.set(origin, dir);
  _probeRaycaster.near = 0;
  _probeRaycaster.far = PROBE_DISTANCE * 2.5;
  _probeHits.length = 0;
  mesh.raycast(_probeRaycaster, _probeHits);
  if (_probeHits.length === 0) return false;
  let best = _probeHits[0];
  for (let i = 1; i < _probeHits.length; i++) if (_probeHits[i].distance < best.distance) best = _probeHits[i];

  const localNormal = best.normal ?? best.face?.normal;
  if (!localNormal) return false;
  _probeNormal.copy(localNormal).transformDirection(mesh.matrixWorld);
  if (_probeNormal.dot(dir) > 0) _probeNormal.negate(); // always face the incoming side
  out.normal.copy(_probeNormal);
  out.surface.copy(best.point);
  out.position.copy(best.point).addScaledVector(out.normal, mesh.material.uniforms.uInflate.value as number);
  _probeHits.length = 0;
  return true;
}

/**
 * Project a world-space hit onto the *actual* rendered shield skin (hull-fit mesh or fallback ellipsoid),
 * using the shield's current world transform (ship position, rotation, bank). First tries the real
 * incoming projectile path; if it grazes past the skin, falls back to the radial line through the hit.
 * Writes world-space results to `out`; returns false when no surface could be found.
 * Allocation-free after module load.
 */
export function projectOntoShieldSurface(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
  hitPoint: THREE.Vector3,
  incomingDirection: THREE.Vector3 | undefined,
  out: ShieldSurfaceHit,
): boolean {
  mesh.updateWorldMatrix(true, false);

  if (incomingDirection && incomingDirection.lengthSq() > 1e-8) {
    _probeDir.copy(incomingDirection).normalize();
    _probeOrigin.copy(hitPoint).addScaledVector(_probeDir, -PROBE_DISTANCE);
    if (castAgainstShield(mesh, _probeOrigin, _probeDir, out)) return true;
  }

  _probeCenter.copy(mesh.material.uniforms.uCenter.value as THREE.Vector3);
  mesh.localToWorld(_probeCenter);
  _probeDir.subVectors(_probeCenter, hitPoint);
  if (_probeDir.lengthSq() < 1e-8) return false;
  _probeDir.normalize();
  _probeOrigin.copy(_probeCenter).addScaledVector(_probeDir, -PROBE_DISTANCE);
  return castAgainstShield(mesh, _probeOrigin, _probeDir, out);
}

let sharedGeometry: THREE.BufferGeometry | null = null;
let nextSeed = 0;

function getShieldGeometry(): THREE.BufferGeometry {
  if (!sharedGeometry) sharedGeometry = new THREE.SphereGeometry(1, 48, 32);
  return sharedGeometry;
}

type ShieldFieldMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> & {
  userData: THREE.Mesh['userData'] & { shieldVisualStrength?: number; collapseElapsed?: number; impactCursor?: number };
};

export function createShieldField(
  color = '#22d3ee',
  shipModel?: THREE.Object3D,
): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const seed = nextSeed++ * 2.37;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uStrength: { value: 1 },
      uRecharge: { value: 0 },
      uCollapse: { value: 0 },
      uSeed: { value: seed },
      uColor: { value: new THREE.Color(color) },
      uCenter: { value: new THREE.Vector3() },
      uHalf: { value: new THREE.Vector3(1, 1, 1) },
      uInflate: { value: 0 },
      uImpactPos: { value: Array.from({ length: MAX_IMPACTS }, () => new THREE.Vector3()) },
      uImpact: { value: Array.from({ length: MAX_IMPACTS }, () => new THREE.Vector2(-1, 0)) },
    },
    vertexShader: VERTEX,
    fragmentShader: DEFINES + FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(getShieldGeometry(), material) as ShieldFieldMesh;
  mesh.name = 'ship-energy-barrier';
  if (shipModel) fitShieldToShip(mesh, shipModel);
  mesh.renderOrder = 4;
  mesh.userData.shieldVisualStrength = 1;
  mesh.userData.collapseElapsed = COLLAPSE_SECONDS;
  return mesh;
}

/** Fit the ellipsoid to the ship model's real local bounds plus a small uniform clearance. */
export function fitShieldToShip(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
  shipModel: THREE.Object3D,
  clearance = 0.28,
): void {
  shipModel.updateMatrixWorld(true);
  if (fitShieldToHull(mesh, shipModel)) return;
  mesh.material.uniforms.uInflate.value = 0;
  mesh.material.side = THREE.DoubleSide;
  const bounds = new THREE.Box3().setFromObject(shipModel);
  const center = bounds.getCenter(new THREE.Vector3());
  const halfSize = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  mesh.position.copy(center);
  const width = halfSize.x + clearance;
  const height = halfSize.y + clearance;
  const length = halfSize.z + clearance;
  mesh.scale.set(width, height, length);
  mesh.userData.baseShieldScale = mesh.scale.clone();

  // A longitudinal loft follows the fighter's planform: narrow at the nose and tail,
  // broad across the wings, with only a small radius around the fuselage and engines.
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const longitudinal = 24;
  const radial = 24;
  for (let i = 0; i <= longitudinal; i++) {
    const t = i / longitudinal;
    const z = -1 + 2 * t;
    const nose = THREE.MathUtils.smoothstep(t, 0, 0.34);
    const tail = 1 - THREE.MathUtils.smoothstep(t, 0.72, 1);
    const fuselage = Math.max(0.22, Math.sin(Math.PI * t) ** 0.45);
    const wingBand = Math.exp(-(((t - 0.53) / 0.2) ** 2));
    const xRadius = width * Math.min(1, Math.max(0.22, fuselage * (0.5 + 0.5 * tail) + wingBand * 0.55));
    const yRadius = height * Math.max(0.26, Math.min(nose, tail) * 0.72 + fuselage * 0.28);
    for (let j = 0; j <= radial; j++) {
      const angle = (j / radial) * Math.PI * 2;
      positions.push(Math.cos(angle) * xRadius, Math.sin(angle) * yRadius, z);
      uvs.push(j / radial, t);
    }
  }
  for (let i = 0; i < longitudinal; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  mesh.geometry = geometry;
  mesh.userData.baseShieldScale = new THREE.Vector3(1, 1, 1);
  mesh.position.copy(center);
  mesh.material.uniforms.uCenter.value.set(0, 0, 0);
  mesh.material.uniforms.uHalf.value.set(width, height, length);
}

const HULL_INFLATE = 0.1;
const _toParent = new THREE.Matrix4();
const _inv = new THREE.Matrix4();

/**
 * Build a thin deflector skin that follows the real hull: all opaque ship meshes are merged into one
 * geometry (single draw call) and pushed outward a few cm along smoothed normals in the vertex shader.
 * It is strictly tighter than the old bounding ellipsoid. Returns false if no usable geometry exists.
 */
function fitShieldToHull(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
  shipModel: THREE.Object3D,
): boolean {
  _inv.copy(shipModel.matrixWorld).invert();
  const parts: THREE.BufferGeometry[] = [];
  shipModel.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh || !m.visible || !m.geometry?.attributes?.position) return;
    const mat = m.material as THREE.Material;
    if (Array.isArray(mat) || mat.transparent || mat.blending === THREE.AdditiveBlending) return; // skip flames/glows
    const g = m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    _toParent.copy(shipModel.matrix).multiply(_inv).multiply(m.matrixWorld);
    g.applyMatrix4(_toParent);
    parts.push(g.index ? g.toNonIndexed() : g);
  });
  if (parts.length === 0) return false;
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!merged) return false;
  // Fully smooth normals so the outward push never opens cracks at hard edges.
  const smooth = toCreasedNormals(merged, Math.PI);
  merged.dispose();
  smooth.computeBoundingBox();
  const box = smooth.boundingBox!;
  const center = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5).addScalar(HULL_INFLATE);
  mesh.geometry = smooth;
  mesh.position.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  mesh.userData.baseShieldScale = new THREE.Vector3(1, 1, 1);
  const u = mesh.material.uniforms;
  u.uCenter.value.copy(center);
  u.uHalf.value.copy(half);
  u.uInflate.value = HULL_INFLATE;
  return true;
}

export function updateShieldField(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
  shield: ShieldState,
  time: number,
  dt = 1 / 60,
): void {
  const field = mesh as ShieldFieldMesh;
  const uniforms = mesh.material.uniforms;
  const strength = shield.max > 0 ? THREE.MathUtils.clamp(shield.current / shield.max, 0, 1) : 0;
  const previousStrength = field.userData.shieldVisualStrength ?? strength;
  let collapseElapsed = field.userData.collapseElapsed ?? COLLAPSE_SECONDS;

  if (previousStrength > 0.005 && strength <= 0.005) collapseElapsed = 0;
  else if (strength <= 0.005) collapseElapsed = Math.min(COLLAPSE_SECONDS, collapseElapsed + Math.max(0, dt));
  else collapseElapsed = COLLAPSE_SECONDS;

  field.userData.shieldVisualStrength = strength;
  field.userData.collapseElapsed = collapseElapsed;
  const collapsing = strength <= 0.005 && collapseElapsed < COLLAPSE_SECONDS;
  const collapse = collapsing ? collapseElapsed / COLLAPSE_SECONDS : 0;

  mesh.visible = strength > 0.005 || collapsing;
  const baseScale = field.userData.baseShieldScale as THREE.Vector3 | undefined;
  if (baseScale) mesh.scale.copy(baseScale);
  if (uniforms.uInflate.value > 0) uniforms.uInflate.value = HULL_INFLATE * (1 + collapse * 0.9);
  uniforms.uTime.value = time;
  uniforms.uStrength.value = strength;
  uniforms.uRecharge.value = shield.isRecharging ? 1 : 0;
  uniforms.uCollapse.value = collapse;

  const impacts = uniforms.uImpact.value as THREE.Vector2[];
  for (let i = 0; i < impacts.length; i++) {
    const imp = impacts[i];
    if (imp.x >= 0) imp.x = imp.x + Math.max(0, dt) > IMPACT_LIFE ? -1 : imp.x + Math.max(0, dt);
  }
}

export function disposeShieldField(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>): void {
  mesh.material.dispose();
  if (mesh.geometry !== sharedGeometry) mesh.geometry.dispose();
}
