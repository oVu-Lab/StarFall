import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GraphicsPreset } from '../config/graphics';
import { WEAPON_CONFIGS } from '../config/weapons';
import { AssetManager } from '../engine/AssetManager';
import type { FlightTelemetry, ShipId } from '../types/game';
import { VANGUARD_HARDPOINTS } from './vanguardModel';

interface PulseCannonVFXProps {
  telemetryRef: React.MutableRefObject<FlightTelemetry>;
  shipId: ShipId;
  active: boolean;
  showcase: boolean;
  graphics: GraphicsPreset;
}

/**
 * Resolves authoritative local-space muzzle coordinates for the active ship.
 * For the VX-9 Vanguard ('interceptor'), uses VANGUARD_HARDPOINTS.cannonMuzzles directly.
 */
export function resolvePulseCannonMuzzles(shipId: ShipId): ReadonlyArray<readonly [number, number, number]> {
  if (shipId === 'interceptor') {
    return VANGUARD_HARDPOINTS.cannonMuzzles;
  }
  return WEAPON_CONFIGS.player_pulse_twin.muzzleOffsets;
}

/**
 * Computes a smooth, crisp discharge envelope for a single pulse cannon shot.
 * Rapid 16ms expansion to peak, followed by tight exponential decay over ~85ms.
 */
export function evaluateMuzzleFlashEnvelope(elapsedSec: number, durationSec = 0.095): {
  intensity: number;
  expansion: number;
  ringProgress: number;
} {
  if (elapsedSec < 0 || elapsedSec >= durationSec) {
    return { intensity: 0, expansion: 0, ringProgress: 1 };
  }
  const t = elapsedSec / durationSec;
  const attack = Math.min(1, elapsedSec / 0.012);
  const decay = Math.pow(Math.max(0, 1 - t), 1.65);
  const intensity = attack * decay;
  const expansion = 1 - Math.pow(1 - t, 3.0);
  return { intensity, expansion, ringProgress: t };
}

// =============================================================================
// CUSTOM GLSL SHADERS — PREMIUM MILITARY SCI-FI BLUE-WHITE PULSE ENERGY
// =============================================================================

const BARREL_GLOW_VERTEX = /* glsl */ `
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

const BARREL_GLOW_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uReadiness;
  uniform float uCharge;
  uniform float uDischarge;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    // Cylinder UV: vUv.y = 0 at rear receiver end, 1 at forward muzzle end
    float axial = vUv.y;
    float endFade = smoothstep(0.0, 0.16, axial) * smoothstep(1.0, 0.88, axial);
    float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float rimSoft = pow(facing, 0.9);

    // Subtle longitudinal electromagnetic rail ribs (2 side rails along barrel)
    float railBand = 0.62 + 0.38 * pow(abs(cos(vUv.x * 6.2831853)), 2.0);

    // Calm readiness pulse + responsive forward-sweeping capacitor buildup wave
    float idleWave = 0.78 + 0.22 * sin(axial * 8.0 - uTime * 3.8);
    float chargeFront = exp(-pow((axial - (0.2 + uCharge * 0.85)) / 0.24, 2.0)) * uCharge;
    float muzzleHot = smoothstep(0.45, 1.0, axial) * (uCharge * 0.65 + uDischarge * 1.45);

    vec3 deepCyan = vec3(0.06, 0.56, 0.88);
    vec3 brightCyan = vec3(0.42, 0.90, 1.0);
    vec3 hotWhite = vec3(0.92, 0.98, 1.0);

    float energy = uReadiness * 0.26 * idleWave + chargeFront * 0.82 + muzzleHot;
    vec3 col = mix(deepCyan, brightCyan, clamp(chargeFront * 0.7 + uDischarge * 0.6, 0.0, 1.0));
    col = mix(col, hotWhite, clamp(muzzleHot * 0.68, 0.0, 1.0));

    float alpha = endFade * rimSoft * railBand * clamp(energy, 0.0, 1.0);
    gl_FragColor = vec4(col * (1.15 + uDischarge * 1.25 + uCharge * 0.45), alpha);
  }
`;

const APERTURE_CORE_VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const APERTURE_CORE_FRAGMENT = /* glsl */ `
  uniform float uReadiness;
  uniform float uCharge;
  uniform float uDischarge;

  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    float core = exp(-r * r * 5.2);
    float rim = exp(-pow((r - 0.68) / 0.16, 2.0)) * 0.75;
    float mask = smoothstep(1.0, 0.72, r);

    vec3 cyan = vec3(0.22, 0.82, 0.98);
    vec3 whiteBlue = vec3(0.94, 0.99, 1.0);

    float level = uReadiness * 0.48 + uCharge * 0.65 + uDischarge * 1.4;
    vec3 col = mix(cyan, whiteBlue, clamp(core * 0.8 + uDischarge * 0.65, 0.0, 1.0));
    float alpha = (core * 0.95 + rim * 0.55) * mask * clamp(level, 0.0, 1.0);
    gl_FragColor = vec4(col * (1.2 + uCharge * 0.8 + uDischarge * 1.9), alpha);
  }
`;

const MUZZLE_JET_VERTEX = /* glsl */ `
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

const MUZZLE_JET_FRAGMENT = /* glsl */ `
  uniform float uIntensity;
  uniform float uTwinBoost;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    // Lathe UV: vUv.y = 0 at muzzle origin, 1 at forward jet tip
    float axial = vUv.y;
    float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float edgeSoft = pow(facing, 0.85);

    // Hot concentrated white-blue core at the aperture, crisp cyan taper toward tip
    float basePinch = smoothstep(0.0, 0.08, axial);
    float tipFade = pow(clamp(1.0 - axial, 0.0, 1.0), 1.45);
    float hotCore = exp(-axial * 3.8) * pow(facing, 1.4);

    vec3 outerBlue = vec3(0.14, 0.70, 0.98);
    vec3 midCyan = vec3(0.56, 0.93, 1.0);
    vec3 coreWhite = vec3(0.97, 0.995, 1.0);

    vec3 col = mix(outerBlue, midCyan, clamp(edgeSoft * 0.85, 0.0, 1.0));
    col = mix(col, coreWhite, clamp(hotCore * 1.15, 0.0, 1.0));

    float boost = 1.0 + uTwinBoost * 0.28;
    float alpha = basePinch * tipFade * edgeSoft * uIntensity;
    gl_FragColor = vec4(col * (1.95 + hotCore * 1.55) * boost, clamp(alpha, 0.0, 1.0));
  }
`;

const STARBURST_VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const STARBURST_FRAGMENT = /* glsl */ `
  uniform float uIntensity;
  uniform float uTwinBoost;

  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    // 4 crisp military-precision orthogonal flare rays (matching fluted muzzle brake vents)
    float rayX = exp(-abs(p.y) * 14.0) * exp(-abs(p.x) * 2.9);
    float rayY = exp(-abs(p.x) * 14.0) * exp(-abs(p.y) * 2.9);
    // Secondary crisp diagonal micro-flares for twin-cannon energy character
    vec2 d = vec2(p.x + p.y, p.x - p.y) * 0.70710678;
    float diag = (exp(-abs(d.y) * 18.0) * exp(-abs(d.x) * 4.8) +
                  exp(-abs(d.x) * 18.0) * exp(-abs(d.y) * 4.8)) * (0.38 + uTwinBoost * 0.28);
    float core = exp(-r * r * 15.0);

    float pattern = clamp(core * 1.15 + (rayX + rayY) * 0.82 + diag, 0.0, 1.5);
    float mask = smoothstep(1.0, 0.55, r);

    vec3 edgeCyan = vec3(0.20, 0.78, 0.99);
    vec3 coreWhite = vec3(0.97, 0.995, 1.0);
    vec3 col = mix(edgeCyan, coreWhite, clamp(core * 1.2 + (rayX + rayY) * 0.35, 0.0, 1.0));

    float alpha = pattern * mask * uIntensity;
    if (alpha < 0.005) discard;
    gl_FragColor = vec4(col * (1.55 + core * 1.15 + uTwinBoost * 0.3), clamp(alpha, 0.0, 1.0));
  }
`;

const MUZZLE_RING_VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MUZZLE_RING_FRAGMENT = /* glsl */ `
  uniform float uIntensity;
  uniform float uProgress;

  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    // Crisp thin expanding electromagnetic shock ring
    float ringCenter = 0.28 + uProgress * 0.62;
    float thickness = mix(0.11, 0.055, uProgress);
    float ring = exp(-pow((r - ringCenter) / thickness, 2.0));

    // Subtle 4-node fluted modulation matching muzzle brake ports
    float angle = atan(p.y, p.x);
    float nodes = 0.78 + 0.22 * cos(angle * 4.0);

    vec3 cyan = vec3(0.28, 0.85, 1.0);
    vec3 whiteBlue = vec3(0.94, 0.99, 1.0);
    vec3 col = mix(cyan, whiteBlue, clamp(ring * (1.0 - uProgress * 0.55), 0.0, 1.0));

    float alpha = ring * nodes * uIntensity * 0.88;
    if (alpha < 0.005) discard;
    gl_FragColor = vec4(col * 1.55, alpha);
  }
`;

/**
 * Builds the streamlined forward plasma discharge jet geometry originating at local (0, 0, 0)
 * and extending forward along -Z to z = -1.0 (scaled dynamically per shot).
 */
export function createMuzzleJetGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.015, 0.0),
    new THREE.Vector2(0.135, 0.14),
    new THREE.Vector2(0.155, 0.28),
    new THREE.Vector2(0.115, 0.52),
    new THREE.Vector2(0.055, 0.78),
    new THREE.Vector2(0.004, 1.0),
  ];
  const geo = new THREE.LatheGeometry(pts, 12);
  // Rotate so Lathe +Y axis aligns cleanly with ship forward (-Z)
  geo.rotateX(-Math.PI / 2);
  return geo;
}

interface BarrelVisualState {
  prevRawTimer: number;
  flashAge: number;
  shotCount: number;
  rollAngle: number;
  cooldownGlow: number;
  chargeLevel: number;
}

interface BarrelRig {
  barrelMat: THREE.ShaderMaterial;
  apertureMat: THREE.ShaderMaterial;
  jetMat: THREE.ShaderMaterial;
  starMat: THREE.ShaderMaterial;
  ringMat: THREE.ShaderMaterial;
  bloomMat: THREE.SpriteMaterial;
  flashGroup: THREE.Group;
  jetMesh: THREE.Mesh;
  starGroup: THREE.Group;
  ringMesh: THREE.Mesh;
  bloomSprite: THREE.Sprite;
  barrelMesh: THREE.Mesh;
  apertureMesh: THREE.Mesh;
}

/**
 * Dedicated Pulse Cannon weapon readiness & muzzle flash VFX renderer.
 * Attached externally inside the ship's bank group at exact VANGUARD_HARDPOINTS.cannonMuzzles
 * so spacecraft geometry and ShieldField hull-fit remain 100% untouched.
 */
export function PulseCannonVFX({
  telemetryRef,
  shipId,
  active,
  showcase,
  graphics,
}: PulseCannonVFXProps) {
  const muzzleLightRef = useRef<THREE.PointLight>(null);
  const glowSpriteTex = useMemo(() => AssetManager.acquireGlowSprite(), []);

  useEffect(() => {
    return () => {
      AssetManager.releaseGlowSprite();
    };
  }, [glowSpriteTex]);

  const muzzles = useMemo(() => resolvePulseCannonMuzzles(shipId), [shipId]);
  // Barrel sleeve / aperture glow geometry is fitted to the VX-9 barrels only; the muzzle
  // flash itself still follows the authoritative firing muzzles for every ship.
  const hasBarrelGlow = shipId === 'interceptor';
  const hasBarrelGlowRef = useRef(hasBarrelGlow);
  hasBarrelGlowRef.current = hasBarrelGlow;

  // Shared lightweight procedural geometries (disposed cleanly on unmount)
  const geometries = useMemo(() => {
    // Tight cylinder wrapping the twin-rail accelerator barrel from z=-0.82 to z=-1.56
    const barrelSleeve = new THREE.CylinderGeometry(0.073, 0.079, 0.74, 12, 1, true);
    // Align cylinder +Y (vUv.y = 1) toward forward muzzle (-Z)
    barrelSleeve.rotateX(-Math.PI / 2);

    const apertureDisc = new THREE.CircleGeometry(0.044, 14);
    // Face forward (-Z) and visible from rear via DoubleSide
    const muzzleJet = createMuzzleJetGeometry();
    const starPlane = new THREE.PlaneGeometry(1.0, 1.0);
    const ringPlane = new THREE.PlaneGeometry(1.0, 1.0);

    return { barrelSleeve, apertureDisc, muzzleJet, starPlane, ringPlane };
  }, []);

  // Build two independent barrel rigs (0 = Left, 1 = Right)
  const rigs = useMemo<BarrelRig[]>(() => {
    return [0, 1].map((idx) => {
      const barrelMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uReadiness: { value: 0.5 },
          uCharge: { value: 0 },
          uDischarge: { value: 0 },
        },
        vertexShader: BARREL_GLOW_VERTEX,
        fragmentShader: BARREL_GLOW_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        toneMapped: false,
      });

      const apertureMat = new THREE.ShaderMaterial({
        uniforms: {
          uReadiness: { value: 0.5 },
          uCharge: { value: 0 },
          uDischarge: { value: 0 },
        },
        vertexShader: APERTURE_CORE_VERTEX,
        fragmentShader: APERTURE_CORE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });

      const jetMat = new THREE.ShaderMaterial({
        uniforms: {
          uIntensity: { value: 0 },
          uTwinBoost: { value: 0 },
        },
        vertexShader: MUZZLE_JET_VERTEX,
        fragmentShader: MUZZLE_JET_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });

      const starMat = new THREE.ShaderMaterial({
        uniforms: {
          uIntensity: { value: 0 },
          uTwinBoost: { value: 0 },
        },
        vertexShader: STARBURST_VERTEX,
        fragmentShader: STARBURST_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });

      const ringMat = new THREE.ShaderMaterial({
        uniforms: {
          uIntensity: { value: 0 },
          uProgress: { value: 0 },
        },
        vertexShader: MUZZLE_RING_VERTEX,
        fragmentShader: MUZZLE_RING_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });

      const bloomMat = new THREE.SpriteMaterial({
        map: glowSpriteTex,
        color: new THREE.Color('#bae6fd'),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });

      const barrelMesh = new THREE.Mesh(geometries.barrelSleeve, barrelMat);
      barrelMesh.name = `pulse-barrel-glow-${idx === 0 ? 'L' : 'R'}`;
      // Center of barrel sleeve (z = -1.19) relative to muzzle z = -1.65 -> +0.46 behind muzzle
      barrelMesh.position.set(0, 0, 0.46);
      barrelMesh.renderOrder = 6;

      const apertureMesh = new THREE.Mesh(geometries.apertureDisc, apertureMat);
      apertureMesh.name = `pulse-aperture-glow-${idx === 0 ? 'L' : 'R'}`;
      apertureMesh.position.set(0, 0, -0.004);
      apertureMesh.renderOrder = 7;

      const flashGroup = new THREE.Group();
      flashGroup.name = `pulse-muzzle-flash-${idx === 0 ? 'L' : 'R'}`;
      flashGroup.visible = false;

      const jetMesh = new THREE.Mesh(geometries.muzzleJet, jetMat);
      jetMesh.renderOrder = 16;
      flashGroup.add(jetMesh);

      // Crossed starburst planes: one perpendicular to firing axis (front/rear read),
      // plus two angled side-vent planes so third-person chase & oblique views both read crisp spikes!
      const starGroup = new THREE.Group();
      const starFront = new THREE.Mesh(geometries.starPlane, starMat);
      starFront.position.set(0, 0, -0.03);
      starFront.renderOrder = 17;
      starGroup.add(starFront);

      const starSideA = new THREE.Mesh(geometries.starPlane, starMat);
      starSideA.position.set(0, 0, -0.18);
      starSideA.rotation.set(0, Math.PI / 2, Math.PI / 4);
      starSideA.scale.set(0.85, 0.65, 1);
      starSideA.renderOrder = 17;
      starGroup.add(starSideA);

      const starSideB = new THREE.Mesh(geometries.starPlane, starMat);
      starSideB.position.set(0, 0, -0.18);
      starSideB.rotation.set(Math.PI / 2, 0, Math.PI / 4);
      starSideB.scale.set(0.65, 0.85, 1);
      starSideB.renderOrder = 17;
      starGroup.add(starSideB);

      flashGroup.add(starGroup);

      const ringMesh = new THREE.Mesh(geometries.ringPlane, ringMat);
      ringMesh.position.set(0, 0, -0.04);
      ringMesh.renderOrder = 16;
      flashGroup.add(ringMesh);

      const bloomSprite = new THREE.Sprite(bloomMat);
      bloomSprite.position.set(0, 0, -0.06);
      bloomSprite.renderOrder = 18;
      flashGroup.add(bloomSprite);

      return {
        barrelMat,
        apertureMat,
        jetMat,
        starMat,
        ringMat,
        bloomMat,
        flashGroup,
        jetMesh,
        starGroup,
        ringMesh,
        bloomSprite,
        barrelMesh,
        apertureMesh,
      };
    });
  }, [geometries, glowSpriteTex]);

  useEffect(() => {
    return () => {
      geometries.barrelSleeve.dispose();
      geometries.apertureDisc.dispose();
      geometries.muzzleJet.dispose();
      geometries.starPlane.dispose();
      geometries.ringPlane.dispose();
      for (const rig of rigs) {
        rig.barrelMat.dispose();
        rig.apertureMat.dispose();
        rig.jetMat.dispose();
        rig.starMat.dispose();
        rig.ringMat.dispose();
        rig.bloomMat.dispose();
      }
    };
  }, [geometries, rigs]);

  const barrelStatesRef = useRef<[BarrelVisualState, BarrelVisualState]>([
    { prevRawTimer: 0, flashAge: 1, shotCount: 0, rollAngle: 0.35, cooldownGlow: 0, chargeLevel: 0 },
    { prevRawTimer: 0, flashAge: 1, shotCount: 0, rollAngle: -0.35, cooldownGlow: 0, chargeLevel: 0 },
  ]);
  const lastFiredBarrelRef = useRef<0 | 1>(1);
  const timeSinceLastShotRef = useRef<number>(99);
  const graphicsRef = useRef(graphics);
  graphicsRef.current = graphics;

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;
    const telemetry = telemetryRef.current;
    const gfx = graphicsRef.current;
    const states = barrelStatesRef.current;
    const rawTimers: [number, number] = [telemetry.muzzleFlashLeft, telemetry.muzzleFlashRight];

    timeSinceLastShotRef.current = Math.min(10, timeSinceLastShotRef.current + dt);

    // Detect fresh shots per barrel by rising edge on CombatManager's muzzleFlash timers
    let triggeredL = false;
    let triggeredR = false;
    if (active) {
      for (let i = 0; i < 2; i++) {
        const s = states[i];
        const raw = rawTimers[i];
        if (raw > 0.001 && raw > s.prevRawTimer + 0.005) {
          // Ignite directly at peak expansion so frame 1 is razor-bright at any framerate
          s.flashAge = 0.012;
          s.shotCount += 1;
          s.cooldownGlow = 1.0;
          s.chargeLevel = 0;
          const sideSign = i === 0 ? 1 : -1;
          s.rollAngle = sideSign * 0.42 + ((s.shotCount * 0.97) % (Math.PI * 0.5));
          lastFiredBarrelRef.current = i as 0 | 1;
          timeSinceLastShotRef.current = 0;
          if (i === 0) triggeredL = true;
          else triggeredR = true;
        }
        s.prevRawTimer = raw;
      }
    } else {
      for (let i = 0; i < 2; i++) {
        states[i].prevRawTimer = 0;
        states[i].flashAge = 1;
        states[i].cooldownGlow = 0;
        states[i].chargeLevel = 0;
      }
    }

    // Twin-fire harmonic activates when both barrels are cycling rapidly in tandem
    const twinCadenceActive =
      active &&
      (timeSinceLastShotRef.current < 0.17 ||
        (states[0].flashAge < 0.14 && states[1].flashAge < 0.14));
    const twinBoost = twinCadenceActive ? 1.0 : 0.0;
    const nextBarrel: 0 | 1 = lastFiredBarrelRef.current === 0 ? 1 : 0;

    let maxFlashIntensity = 0;
    let lightX = 0;
    let lightWeight = 0;

    for (let i = 0; i < 2; i++) {
      const rig = rigs[i];
      const s = states[i];
      const justTriggered = i === 0 ? triggeredL : triggeredR;

      if (!justTriggered) {
        s.flashAge = Math.min(1, s.flashAge + dt);
      }
      s.cooldownGlow = Math.max(0, s.cooldownGlow - dt * 5.0);

      // Subtle pre-fire capacitor buildup on the next barrel queued to discharge
      const targetCharge =
        active && telemetry.isFiring && i === nextBarrel
          ? THREE.MathUtils.clamp(1.0 - telemetry.weaponCooldownRatio * 1.15, 0.18, 1.0)
          : active && telemetry.isFiring
            ? 0.22
            : 0.0;
      s.chargeLevel = THREE.MathUtils.damp(s.chargeLevel, targetCharge, 22, dt);

      const env = active
        ? evaluateMuzzleFlashEnvelope(s.flashAge, 0.095)
        : { intensity: 0, expansion: 0, ringProgress: 1 };
      const flashVisible = active && env.intensity > 0.01;

      // Weapon readiness aura (subtle in hangar/menu, combat-ready in flight)
      const showReadiness = hasBarrelGlowRef.current && (active || showcase);
      const readinessLevel = active ? 0.68 : showcase ? 0.34 : 0;
      rig.barrelMesh.visible = showReadiness;
      rig.apertureMesh.visible = showReadiness;

      if (showReadiness) {
        rig.barrelMat.uniforms.uTime.value = t;
        rig.barrelMat.uniforms.uReadiness.value = readinessLevel;
        rig.barrelMat.uniforms.uCharge.value = s.chargeLevel;
        rig.barrelMat.uniforms.uDischarge.value = Math.max(env.intensity, s.cooldownGlow * 0.55);

        rig.apertureMat.uniforms.uReadiness.value = readinessLevel;
        rig.apertureMat.uniforms.uCharge.value = s.chargeLevel;
        rig.apertureMat.uniforms.uDischarge.value = Math.max(env.intensity, s.cooldownGlow * 0.65);
      }

      // Multi-layer muzzle flash originating cleanly at exact cannon muzzle
      rig.flashGroup.visible = flashVisible;
      if (flashVisible) {
        const pulseScale = 0.96 + twinBoost * 0.14;
        const jetLen = (0.72 + env.expansion * 1.48) * pulseScale;
        const jetRad = (0.95 + env.intensity * 0.55) * pulseScale;
        rig.jetMesh.scale.set(jetRad, jetRad, jetLen);
        rig.jetMat.uniforms.uIntensity.value = env.intensity;
        rig.jetMat.uniforms.uTwinBoost.value = twinBoost;

        const starScale = (0.68 + env.expansion * 0.88) * pulseScale;
        rig.starGroup.scale.setScalar(starScale);
        rig.starGroup.rotation.z = s.rollAngle;
        rig.starMat.uniforms.uIntensity.value = env.intensity;
        rig.starMat.uniforms.uTwinBoost.value = twinBoost;

        const ringScale = (0.36 + env.expansion * 0.82) * pulseScale;
        rig.ringMesh.scale.setScalar(ringScale);
        rig.ringMesh.position.z = -0.04 - env.expansion * 0.34;
        rig.ringMesh.rotation.z = s.rollAngle * 0.5;
        rig.ringMat.uniforms.uIntensity.value = env.intensity * 0.95;
        rig.ringMat.uniforms.uProgress.value = env.ringProgress;

        rig.bloomSprite.visible = gfx.postGlowEnabled;
        if (gfx.postGlowEnabled) {
          const bloomSize = (0.85 + env.intensity * 1.05) * pulseScale;
          rig.bloomSprite.scale.setScalar(bloomSize);
          rig.bloomMat.opacity = Math.min(0.95, env.intensity * 1.0);
        }

        if (env.intensity > maxFlashIntensity) {
          maxFlashIntensity = env.intensity;
        }
        lightX += muzzles[i][0] * env.intensity;
        lightWeight += env.intensity;
      }
    }

    // Shared lightweight dynamic muzzle bounce light on hull titanium (no shadows).
    // Kept permanently visible (intensity 0 when idle): toggling `visible` changes the scene's
    // light count and forces every lit material to recompile mid-combat.
    const muzzleLight = muzzleLightRef.current;
    if (muzzleLight) {
      if (active && gfx.postGlowEnabled && maxFlashIntensity > 0.02 && lightWeight > 0.001) {
        muzzleLight.position.set(
          lightX / lightWeight,
          muzzles[0][1] + 0.08,
          muzzles[0][2] - 0.12,
        );
        muzzleLight.intensity = maxFlashIntensity * (3.2 + twinBoost * 1.1);
      } else {
        muzzleLight.intensity = 0;
      }
    }
  });

  return (
    <group name="pulse-cannon-vfx">
      {muzzles.map((pos, idx) => (
        <group
          key={idx}
          name={`pulse-cannon-hardpoint-${idx === 0 ? 'L' : 'R'}`}
          position={[pos[0], pos[1], pos[2]]}
        >
          <primitive object={rigs[idx].barrelMesh} />
          <primitive object={rigs[idx].apertureMesh} />
          <primitive object={rigs[idx].flashGroup} />
        </group>
      ))}
      <pointLight
        ref={muzzleLightRef}
        color="#7dd3fc"
        intensity={0}
        distance={7.5}
        decay={2}
      />
    </group>
  );
}
