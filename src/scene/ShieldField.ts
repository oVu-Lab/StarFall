import * as THREE from 'three';
import type { ShieldState } from '../types/combat';

const VERTEX = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  void main() {
    vLocal = normalize(position);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
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
  varying vec3 vLocal;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    float longitude = atan(vLocal.z, vLocal.x);
    float latitude = asin(clamp(vLocal.y, -1.0, 1.0));
    float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float rim = pow(1.0 - facing, 3.1);

    // A few uneven, traveling energy streams give the shell motion without a grid or cell pattern.
    float streamPathA = 0.28 * sin(longitude * 2.0 - uTime * 0.48 + uSeed)
      + 0.11 * sin(longitude * 4.3 + uTime * 0.74 + uSeed * 1.7);
    float streamPathB = -0.42 + 0.17 * sin(longitude * 1.55 + uTime * 0.37 + uSeed * 2.1);
    float streamPathC = 0.56 * sin(longitude * 1.18 - uTime * 0.61 + uSeed * 0.7);
    float streamA = 1.0 - smoothstep(0.0, 0.024, abs(latitude - streamPathA));
    float streamB = 1.0 - smoothstep(0.0, 0.018, abs(latitude - streamPathB));
    float streamC = 1.0 - smoothstep(0.0, 0.016, abs(latitude - streamPathC));

    // Narrow arcs appear intermittently and travel around the barrier, especially when energy is low.
    float arcWave = sin(longitude * 8.0 + sin(latitude * 5.0 + uTime * 0.9 + uSeed) * 1.6
      - uTime * (1.15 + (1.0 - uStrength) * 1.2) + uSeed * 3.0);
    float arcBand = 1.0 - smoothstep(0.0, 0.024, abs(latitude - 0.2 * arcWave));
    float arcPulse = pow(max(0.0, sin(uTime * (1.8 + (1.0 - uStrength) * 4.0) + longitude * 5.0 + uSeed)), 14.0);
    float energyFront = pow(max(0.0, sin(longitude * 2.5 - uTime * 0.43 + uSeed)
      * cos(latitude * 3.2 + uTime * 0.52)), 7.0);

    float unstable = 1.0 - smoothstep(0.16, 0.48, uStrength);
    float arcPath = 0.22 * sin(longitude * 5.2 - uTime * 1.7 + uSeed)
      + 0.13 * sin(longitude * 10.4 + uTime * 1.15 + uSeed * 1.8);
    float arcStroke = 1.0 - smoothstep(0.0, 0.018, abs(latitude - arcPath));
    float arcGateWave = sin(longitude * 3.1 + uTime * (1.0 + unstable * 1.8) + uSeed * 2.6);
    float arcGate = smoothstep(0.78 - unstable * 0.3, 0.94 - unstable * 0.2, arcGateWave);
    float lightning = arcStroke * arcGate * (0.34 + unstable * 0.66)
      * (0.42 + 0.58 * pow(max(0.0, sin(uTime * 7.0 + longitude * 13.0 + uSeed)), 5.0));
    float flicker = 1.0 - unstable * (0.26 * step(0.83, fract(sin(floor(uTime * 18.0 + uSeed * 9.0) * 17.17) * 43758.5)));
    float pulse = 0.9 + 0.1 * sin(uTime * (1.4 + unstable * 4.0) + longitude * 2.0 + uSeed);

    // During regeneration, a visible energy front sweeps across the envelope as capacity returns.
    float polarProgress = acos(clamp(vLocal.y, -1.0, 1.0)) / 3.14159265;
    float forming = mix(1.0, smoothstep(polarProgress - 0.11, polarProgress + 0.08, uStrength), uRecharge);

    float body = 0.018 + rim * 0.16;
    float energyLines = streamA * 0.2 + streamB * 0.13 + streamC * 0.16
      + arcBand * arcPulse * (0.27 + unstable * 0.65) + energyFront * 0.07 + lightning * 0.48;
    float alpha = (body + energyLines + arcPulse * 0.12) * (0.36 + 0.64 * uStrength) * pulse * flicker * forming;
    alpha *= (1.0 - uCollapse) * mix(1.0, 1.4, uRecharge);

    vec3 blueWhite = vec3(0.78, 0.94, 1.0);
    vec3 energyColor = mix(uColor, blueWhite, clamp(rim * 0.72 + streamA * 0.65 + streamC * 0.65 + arcPulse + lightning, 0.0, 1.0));
    energyColor *= 0.9 + rim * 1.2 + streamA * 1.8 + streamB * 1.2 + streamC * 1.5 + energyFront * 1.1 + arcPulse * 2.8 + lightning * 3.0;
    gl_FragColor = vec4(energyColor, alpha);
  }
`;

const COLLAPSE_SECONDS = 0.52;
let sharedGeometry: THREE.BufferGeometry | null = null;
let nextSeed = 0;

function getShieldGeometry(): THREE.BufferGeometry {
  if (!sharedGeometry) sharedGeometry = new THREE.SphereGeometry(1, 48, 32);
  return sharedGeometry;
}

type ShieldFieldMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> & {
  userData: THREE.Mesh['userData'] & { shieldVisualStrength?: number; collapseElapsed?: number };
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
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
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
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  mesh.geometry = geometry;
  mesh.userData.baseShieldScale = new THREE.Vector3(1, 1, 1);
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
  if (baseScale) mesh.scale.copy(baseScale).multiplyScalar(1 + collapse * 0.025);
  uniforms.uTime.value = time;
  uniforms.uStrength.value = strength;
  uniforms.uRecharge.value = shield.isRecharging ? 1 : 0;
  uniforms.uCollapse.value = collapse;
}

export function disposeShieldField(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>): void {
  mesh.material.dispose();
  if (mesh.geometry !== sharedGeometry) mesh.geometry.dispose();
}
