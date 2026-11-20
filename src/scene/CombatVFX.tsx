import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GraphicsPreset } from '../config/graphics';
import { AssetManager } from '../engine/AssetManager';
import type { CombatManager, VfxBurstEvent } from '../engine/combat/CombatManager';
import { MAX_POOLED_PROJECTILES } from '../engine/combat/ProjectilePool';
import type { FlightTelemetry } from '../types/game';

export interface CombatVFXHandle {
  spawnBurst: (evt: VfxBurstEvent) => void;
  clear: () => void;
}

interface CombatVFXProps {
  combat: CombatManager;
  telemetryRef: React.MutableRefObject<FlightTelemetry>;
  active: boolean;
  graphics: GraphicsPreset;
}

const MAX_SPARK_POOL = 320;
const MAX_SHOCKWAVE_POOL = 16;

interface SparkParticle {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  maxAge: number;
  size: number;
  stretchFactor: number;
  drag: number;
  color: THREE.Color;
}

interface ShockwaveSlot {
  active: boolean;
  kind: VfxBurstEvent['kind'];
  position: THREE.Vector3;
  normal: THREE.Vector3;
  age: number;
  maxAge: number;
  maxScale: number;
  isExplosion: boolean;
  isShield: boolean;
  isShieldBreak: boolean;
  isHullImpact: boolean;
  rollAngle: number;
}

interface ShockMeshSlot {
  group: THREE.Group;
  core: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.ShaderMaterial;
  flash: THREE.Sprite;
  flashMat: THREE.SpriteMaterial;
  arcs: THREE.LineSegments;
  arcMat: THREE.LineBasicMaterial;
}

// Module-scope reusable scratch math objects (zero per-frame GC allocations)
const _dummy = new THREE.Object3D();
const _upVec = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _rollQuat = new THREE.Quaternion();
const _hiddenScale = new THREE.Vector3(0, 0, 0);
const _ringNormal = new THREE.Vector3(0, 0, 1);
const _impactNormal = new THREE.Vector3(0, 0, 1);
const _tangentA = new THREE.Vector3();
const _tangentB = new THREE.Vector3();
const _refAxis = new THREE.Vector3();
const _velDir = new THREE.Vector3();

// =============================================================================
// CUSTOM PROCEDURAL GEOMETRIES FOR PULSE CANNON PROJECTILES & SPARKS
// =============================================================================

/**
 * Streamlined tapered energy bolt core aligned along +Y (y in [-0.5, +0.5], max radius 0.115).
 * Rounded leading plasma tip (+0.5) and clean tapered rear (-0.5).
 */
export function createPulseBoltCoreGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.003, -0.50),
    new THREE.Vector2(0.062, -0.34),
    new THREE.Vector2(0.118, -0.06),
    new THREE.Vector2(0.142, 0.24),
    new THREE.Vector2(0.118, 0.40),
    new THREE.Vector2(0.060, 0.47),
    new THREE.Vector2(0.003, 0.50),
  ];
  return new THREE.LatheGeometry(pts, 8);
}

/**
 * Controlled outer plasma glow sheath wrapping the pulse bolt core (y in [-0.56, +0.54]).
 */
export function createPulseBoltGlowGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.005, -0.56),
    new THREE.Vector2(0.165, -0.36),
    new THREE.Vector2(0.315, -0.04),
    new THREE.Vector2(0.34, 0.24),
    new THREE.Vector2(0.25, 0.43),
    new THREE.Vector2(0.005, 0.54),
  ];
  return new THREE.LatheGeometry(pts, 10);
}

/**
 * Short, clean tapered energy trail anchored at y = 0 (rear of bolt) extending to y = -1.0.
 */
export function createPulseBoltTrailGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.015, -1.0),
    new THREE.Vector2(0.072, -0.62),
    new THREE.Vector2(0.158, -0.22),
    new THREE.Vector2(0.195, 0.0),
  ];
  return new THREE.LatheGeometry(pts, 8);
}

/**
 * Sleek velocity-aligned diamond streak needle for sharp shield & hull impact sparks.
 */
export function createSparkStreakGeometry(): THREE.BufferGeometry {
  const geo = new THREE.OctahedronGeometry(0.11, 0);
  geo.scale(0.85, 3.6, 0.85);
  return geo;
}

// =============================================================================
// INSTANCED GLSL SHADERS FOR PULSE CANNON PROJECTILES & IMPACT RIPPLES
// =============================================================================

const INSTANCED_BOLT_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    #ifdef USE_INSTANCING
      vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      vec3 c0 = instanceMatrix[0].xyz;
      vec3 c1 = instanceMatrix[1].xyz;
      vec3 c2 = instanceMatrix[2].xyz;
      vec3 invS = vec3(
        1.0 / max(length(c0), 0.0001),
        1.0 / max(length(c1), 0.0001),
        1.0 / max(length(c2), 0.0001)
      );
      vec3 nScaled = normal * invS;
      vec3 instNorm = normalize(
        c0 * (invS.x * nScaled.x) +
        c1 * (invS.y * nScaled.y) +
        c2 * (invS.z * nScaled.z)
      );
      vNormalView = normalize(normalMatrix * instNorm);
    #else
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vNormalView = normalize(normalMatrix * normal);
    #endif
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PULSE_CORE_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    // vUv.y = 0 at rear tip, 1 at leading nose tip
    float axial = vUv.y;
    float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float centerBoost = pow(facing, 0.65);

    // Concentrated white-hot leading body with crisp cyan-white rear taper
    float leadHeat = smoothstep(0.12, 0.86, axial);
    float tailSoft = smoothstep(0.0, 0.16, axial);

    vec3 rearCyan = vec3(0.46, 0.90, 1.0);
    vec3 coreWhite = vec3(0.98, 0.996, 1.0);
    vec3 col = mix(rearCyan, coreWhite, clamp(leadHeat * 0.55 + centerBoost * 0.62, 0.0, 1.0));

    float alpha = tailSoft * (0.78 + 0.22 * centerBoost);
    gl_FragColor = vec4(col * (1.75 + leadHeat * 0.65), alpha);
  }
`;

const PULSE_GLOW_FRAGMENT = /* glsl */ `
  uniform float uGlowIntensity;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    float axial = vUv.y;
    float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    // Soft Fresnel-like radial falloff eliminates any hard cylinder silhouette
    float radialSoft = pow(facing, 1.75);
    float endSoft = smoothstep(0.0, 0.22, axial) * smoothstep(1.0, 0.78, axial);

    vec3 deepBlue = vec3(0.04, 0.52, 0.94);
    vec3 electricCyan = vec3(0.32, 0.86, 1.0);
    vec3 innerTint = vec3(0.84, 0.97, 1.0);

    vec3 col = mix(deepBlue, electricCyan, clamp(radialSoft * 1.15, 0.0, 1.0));
    col = mix(col, innerTint, clamp(pow(facing, 3.0) * smoothstep(0.25, 0.85, axial) * 0.75, 0.0, 1.0));

    float alpha = radialSoft * endSoft * 0.78 * uGlowIntensity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col * 1.75, alpha);
  }
`;

const PULSE_TRAIL_FRAGMENT = /* glsl */ `
  uniform float uGlowIntensity;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    // vUv.y = 0 at far tail tip, 1 at bolt junction
    float axial = vUv.y;
    float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float radialSoft = pow(facing, 1.25);

    // Clean short taper: brightest right behind bolt, smoothly vanishing with zero hard cutoff
    float axialFade = pow(clamp(axial, 0.0, 1.0), 1.75) * smoothstep(1.0, 0.90, axial);

    vec3 tailBlue = vec3(0.06, 0.50, 0.92);
    vec3 headCyan = vec3(0.56, 0.94, 1.0);
    vec3 col = mix(tailBlue, headCyan, axial);

    float alpha = axialFade * radialSoft * 0.68 * uGlowIntensity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col * 1.55, alpha);
  }
`;

const IMPACT_RING_VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const IMPACT_RING_FRAGMENT = /* glsl */ `
  uniform float uProgress;
  uniform float uOpacity;
  uniform float uMode; // 0.0 = shield deflection, 1.0 = hull thermal-plasma strike, 2.0 = explosion/generic
  uniform vec3 uColorInner;
  uniform vec3 uColorOuter;

  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    float angle = atan(p.y, p.x);

    if (uMode < 0.5) {
      // SHIELD DEFLECTION RIPPLE: crisp concentric energy wave + hex-segmented barrier harmonics
      float wavePos = 0.20 + uProgress * 0.72;
      float waveW = mix(0.11, 0.048, uProgress);
      float outerWave = exp(-pow((r - wavePos) / waveW, 2.0));
      float innerWave = exp(-pow((r - wavePos * 0.64) / (waveW * 1.25), 2.0)) * 0.55;
      float centerPinch = exp(-r * r * 12.0) * pow(1.0 - uProgress, 2.2);

      // Subtle 6-fold crystalline shield interference pattern
      float hexHarmonic = 0.76 + 0.24 * cos(angle * 6.0 + uProgress * 3.5);
      float fieldMask = smoothstep(1.0, 0.80, r);

      float energy = (outerWave * hexHarmonic + innerWave * 0.7 + centerPinch * 1.1) * fieldMask;
      vec3 col = mix(uColorOuter, uColorInner, clamp(outerWave * 0.65 + centerPinch * 1.2, 0.0, 1.0));
      float alpha = energy * uOpacity;
      if (alpha < 0.005) discard;
      gl_FragColor = vec4(col * 1.65, clamp(alpha, 0.0, 1.0));
    } else if (uMode < 1.5) {
      // HULL ARMOR STRIKE: compact high-contrast thermal breach flash + jagged directional flare
      float flashCore = exp(-r * r * 8.5) * pow(1.0 - uProgress, 1.4);
      float ringPos = 0.16 + uProgress * 0.68;
      float ring = exp(-pow((r - ringPos) / 0.085, 2.0)) * (0.65 + 0.35 * sin(angle * 8.0 + 1.2));
      // Brief 4-spike armor spark cross at entry point
      float crossFlare = (exp(-abs(p.y) * 14.0) * exp(-abs(p.x) * 3.8) +
                          exp(-abs(p.x) * 14.0) * exp(-abs(p.y) * 3.8)) * pow(1.0 - uProgress, 2.0) * 0.75;
      float mask = smoothstep(1.0, 0.62, r);

      float energy = (flashCore * 1.2 + ring * 0.72 + crossFlare) * mask;
      vec3 col = mix(uColorOuter, uColorInner, clamp(flashCore * 1.1 + crossFlare * 0.7, 0.0, 1.0));
      float alpha = energy * uOpacity;
      if (alpha < 0.005) discard;
      gl_FragColor = vec4(col * 1.75, clamp(alpha, 0.0, 1.0));
    } else {
      // EXPLOSION / GENERIC SHOCKWAVE
      float wavePos = 0.25 + uProgress * 0.68;
      float wave = exp(-pow((r - wavePos) / 0.095, 2.0));
      float mask = smoothstep(1.0, 0.82, r);
      vec3 col = mix(uColorOuter, uColorInner, wave * (1.0 - uProgress * 0.4));
      float alpha = wave * mask * uOpacity;
      if (alpha < 0.005) discard;
      gl_FragColor = vec4(col * 1.5, clamp(alpha, 0.0, 1.0));
    }
  }
`;

/**
 * Pooled high-craft combat visual effects renderer:
 * - Instanced 3-layer Pulse Cannon bolts (blue-white core + soft plasma glow + short clean trail)
 * - Enemy plasma bolts & homing missiles (preserved intact)
 * - Velocity-aligned pooled impact & explosion spark streaks
 * - Distinct localized shield deflection vs hull armor impact effects at exact collision points
 * Zero per-frame allocations; reports active particle count to telemetryRef.
 */
export const CombatVFX = forwardRef<CombatVFXHandle, CombatVFXProps>(
  function CombatVFX({ combat, telemetryRef, active, graphics }, ref) {
    const playerBoltCoreRef = useRef<THREE.InstancedMesh>(null);
    const playerBoltGlowRef = useRef<THREE.InstancedMesh>(null);
    const playerBoltTrailRef = useRef<THREE.InstancedMesh>(null);
    const enemyBoltsRef = useRef<THREE.InstancedMesh>(null);
    const sparksRef = useRef<THREE.InstancedMesh>(null);
    const missilesRef = useRef<THREE.InstancedMesh>(null);
    const missileTrailsRef = useRef<THREE.InstancedMesh>(null);
    const shockwaveGroupRef = useRef<THREE.Group>(null);

    const glowSpriteTex = useMemo(() => AssetManager.acquireGlowSprite(), []);

    useEffect(() => {
      return () => {
        AssetManager.releaseGlowSprite();
      };
    }, [glowSpriteTex]);

    // Player Pulse Cannon 3-layer projectile geometry & custom instanced shaders
    const pulseCoreGeo = useMemo(() => createPulseBoltCoreGeometry(), []);
    const pulseGlowGeo = useMemo(() => createPulseBoltGlowGeometry(), []);
    const pulseTrailGeo = useMemo(() => createPulseBoltTrailGeometry(), []);

    const pulseCoreMat = useMemo(
      () =>
        new THREE.ShaderMaterial({
          vertexShader: INSTANCED_BOLT_VERTEX,
          fragmentShader: PULSE_CORE_FRAGMENT,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      [],
    );

    const pulseGlowMat = useMemo(
      () =>
        new THREE.ShaderMaterial({
          uniforms: {
            uGlowIntensity: { value: 1.0 },
          },
          vertexShader: INSTANCED_BOLT_VERTEX,
          fragmentShader: PULSE_GLOW_FRAGMENT,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      [],
    );

    const pulseTrailMat = useMemo(
      () =>
        new THREE.ShaderMaterial({
          uniforms: {
            uGlowIntensity: { value: 1.0 },
          },
          vertexShader: INSTANCED_BOLT_VERTEX,
          fragmentShader: PULSE_TRAIL_FRAGMENT,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      [],
    );

    // Preserved enemy bolt & homing missile geometries/materials
    const enemyBoltGeo = useMemo(() => new THREE.CylinderGeometry(0.14, 0.14, 1, 6, 1), []);
    const missileGeo = useMemo(() => new THREE.ConeGeometry(0.42, 2.2, 7), []);
    const missileTrailGeo = useMemo(() => new THREE.CylinderGeometry(0.04, 0.32, 2.6, 6), []);
    const missileMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#fb923c', toneMapped: false }), []);
    const missileTrailMat = useMemo(
      () =>
        new THREE.MeshBasicMaterial({
          color: '#f97316',
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      [],
    );
    const enemyBoltMat = useMemo(
      () =>
        new THREE.MeshBasicMaterial({
          color: '#fb923c',
          transparent: true,
          opacity: 0.96,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      [],
    );

    // Upgraded sleek velocity-aligned spark streak geometry
    const sparkGeo = useMemo(() => createSparkStreakGeometry(), []);
    const sparkMat = useMemo(
      () =>
        new THREE.MeshBasicMaterial({
          color: '#ffffff',
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      [],
    );

    const shockSphereGeo = useMemo(() => new THREE.SphereGeometry(1, 14, 10), []);
    const shockPlaneGeo = useMemo(() => new THREE.PlaneGeometry(2, 2), []);
    const shockArcGeo = useMemo(() => {
      const points: number[] = [];
      const arcs = [
        { start: -2.55, end: -0.52, phase: 0.25 },
        { start: 0.18, end: 2.45, phase: 1.85 },
        { start: 3.15, end: 5.55, phase: 3.3 },
      ];
      for (const arc of arcs) {
        const segments = 12;
        let px = 0;
        let py = 0;
        for (let i = 0; i <= segments; i++) {
          const t = i / segments;
          const angle = arc.start + (arc.end - arc.start) * t;
          const radius =
            0.78 + Math.sin(t * 29 + arc.phase) * 0.08 + Math.sin(t * 51 + arc.phase) * 0.04;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          if (i > 0) points.push(px, py, 0.015, x, y, 0.015);
          px = x;
          py = y;
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      return geometry;
    }, []);

    const particles = useMemo<SparkParticle[]>(() => {
      const arr: SparkParticle[] = [];
      for (let i = 0; i < MAX_SPARK_POOL; i++) {
        arr.push({
          active: false,
          position: new THREE.Vector3(),
          velocity: new THREE.Vector3(),
          age: 0,
          maxAge: 0.4,
          size: 1,
          stretchFactor: 1.5,
          drag: 2.2,
          color: new THREE.Color('#38bdf8'),
        });
      }
      return arr;
    }, []);
    const sparkCursor = useRef(0);

    const shockwaves = useMemo<ShockwaveSlot[]>(() => {
      const arr: ShockwaveSlot[] = [];
      for (let i = 0; i < MAX_SHOCKWAVE_POOL; i++) {
        arr.push({
          active: false,
          kind: 'impact',
          position: new THREE.Vector3(),
          normal: new THREE.Vector3(0, 0, 1),
          age: 0,
          maxAge: 0.4,
          maxScale: 4,
          isExplosion: false,
          isShield: false,
          isShieldBreak: false,
          isHullImpact: false,
          rollAngle: 0,
        });
      }
      return arr;
    }, []);
    const shockCursor = useRef(0);

    const shockMeshes = useMemo<ShockMeshSlot[]>(() => {
      return Array.from({ length: MAX_SHOCKWAVE_POOL }, () => {
        const group = new THREE.Group();
        group.visible = false;

        const coreMat = new THREE.MeshBasicMaterial({
          color: '#e0f2fe',
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        const core = new THREE.Mesh(shockSphereGeo, coreMat);
        core.renderOrder = 16;
        group.add(core);

        const ringMat = new THREE.ShaderMaterial({
          uniforms: {
            uProgress: { value: 0 },
            uOpacity: { value: 0 },
            uMode: { value: 0 },
            uColorInner: { value: new THREE.Color('#f0f9ff') },
            uColorOuter: { value: new THREE.Color('#38bdf8') },
          },
          vertexShader: IMPACT_RING_VERTEX,
          fragmentShader: IMPACT_RING_FRAGMENT,
          transparent: true,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        const ring = new THREE.Mesh(shockPlaneGeo, ringMat);
        ring.renderOrder = 16;
        group.add(ring);

        const arcMat = new THREE.LineBasicMaterial({
          color: '#f0f9ff',
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        const arcs = new THREE.LineSegments(shockArcGeo, arcMat);
        arcs.renderOrder = 17;
        group.add(arcs);

        const flashMat = new THREE.SpriteMaterial({
          map: glowSpriteTex,
          color: '#7dd3fc',
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        const flash = new THREE.Sprite(flashMat);
        flash.renderOrder = 18;
        group.add(flash);

        return { group, core, coreMat, ring, ringMat, flash, flashMat, arcs, arcMat };
      });
    }, [shockArcGeo, shockPlaneGeo, shockSphereGeo, glowSpriteTex]);

    const graphicsRef = useRef(graphics);
    graphicsRef.current = graphics;

    useEffect(() => {
      return () => {
        pulseCoreGeo.dispose();
        pulseGlowGeo.dispose();
        pulseTrailGeo.dispose();
        pulseCoreMat.dispose();
        pulseGlowMat.dispose();
        pulseTrailMat.dispose();
        enemyBoltGeo.dispose();
        missileGeo.dispose();
        missileTrailGeo.dispose();
        missileMat.dispose();
        missileTrailMat.dispose();
        enemyBoltMat.dispose();
        sparkGeo.dispose();
        sparkMat.dispose();
        shockSphereGeo.dispose();
        shockPlaneGeo.dispose();
        shockArcGeo.dispose();
        for (const m of shockMeshes) {
          m.coreMat.dispose();
          m.ringMat.dispose();
          m.flashMat.dispose();
          m.arcMat.dispose();
        }
      };
    }, [
      pulseCoreGeo,
      pulseGlowGeo,
      pulseTrailGeo,
      pulseCoreMat,
      pulseGlowMat,
      pulseTrailMat,
      enemyBoltGeo,
      missileGeo,
      missileTrailGeo,
      missileMat,
      missileTrailMat,
      enemyBoltMat,
      shockMeshes,
      shockPlaneGeo,
      shockArcGeo,
      shockSphereGeo,
      sparkGeo,
      sparkMat,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        spawnBurst: (evt: VfxBurstEvent) => {
          const gfx = graphicsRef.current;
          const isExplosion = evt.kind === 'explosion';
          const isShield = evt.kind === 'shield-hit' || evt.kind === 'shield-break';
          const isShieldBreak = evt.kind === 'shield-break';
          const isPlayerHit = evt.kind === 'player-hit';
          const isHullImpact = evt.kind === 'impact';

          const baseCount = isExplosion
            ? 30
            : isShieldBreak
              ? 18
              : isShield
                ? 10
                : isHullImpact
                  ? 11
                  : 8;
          const sparkCount = Math.max(4, Math.round(baseCount * gfx.sparkScaleFactor));
          const sparkPoolLimit = Math.min(MAX_SPARK_POOL, gfx.maxSparkParticles);
          const shockPoolLimit = Math.min(MAX_SHOCKWAVE_POOL, gfx.maxShockwaves);

          // Resolve normalized surface normal for directional deflection / armor ricochet
          if (evt.normal && evt.normal.lengthSq() > 0.0001) {
            _impactNormal.copy(evt.normal).normalize();
          } else {
            _impactNormal.set(0, 0, 1);
          }

          // Orthonormal tangent basis for shield skimming & hull ricochet cones
          if (Math.abs(_impactNormal.y) < 0.92) _refAxis.set(0, 1, 0);
          else _refAxis.set(1, 0, 0);
          _tangentA.crossVectors(_refAxis, _impactNormal).normalize();
          _tangentB.crossVectors(_impactNormal, _tangentA).normalize();

          const swIdx = shockCursor.current % shockPoolLimit;
          shockCursor.current += 1;
          const sw = shockwaves[swIdx];
          sw.active = true;
          sw.kind = evt.kind;
          sw.position.copy(evt.position);
          sw.normal.copy(_impactNormal);
          sw.age = 0;
          sw.isExplosion = isExplosion;
          sw.isShield = isShield;
          sw.isShieldBreak = isShieldBreak;
          sw.isHullImpact = isHullImpact;
          sw.rollAngle = (shockCursor.current * 1.17) % (Math.PI * 2);

          if (isExplosion) {
            sw.maxAge = 0.66;
            sw.maxScale = 16.5 * evt.scale;
          } else if (isShieldBreak) {
            sw.maxAge = 0.44;
            sw.maxScale = 6.8 * evt.scale;
          } else if (isShield) {
            sw.maxAge = 0.25;
            sw.maxScale = 3.4 * evt.scale;
          } else if (isHullImpact) {
            sw.maxAge = 0.19;
            sw.maxScale = 2.25 * evt.scale;
          } else {
            sw.maxAge = 0.22;
            sw.maxScale = 3.2 * evt.scale;
          }

          const meshSlot = shockMeshes[swIdx];
          _quat.setFromUnitVectors(_ringNormal, _impactNormal);
          _rollQuat.setFromAxisAngle(_impactNormal, sw.rollAngle);
          meshSlot.ring.quaternion.copy(_rollQuat).multiply(_quat);
          meshSlot.arcs.quaternion.copy(meshSlot.ring.quaternion);

          if (isShield) {
            // Distinct icy blue-white & electric-cyan shield deflection
            meshSlot.ringMat.uniforms.uMode.value = 0.0;
            meshSlot.ringMat.uniforms.uColorInner.value.set(isShieldBreak ? '#ffffff' : '#f0f9ff');
            meshSlot.ringMat.uniforms.uColorOuter.value.set(isShieldBreak ? '#38bdf8' : '#0ea5e9');
            meshSlot.arcMat.color.set(isShieldBreak ? '#ffffff' : '#bae6fd');
            meshSlot.coreMat.color.set('#f0f9ff');
            meshSlot.flashMat.color.set('#67e8f9');
          } else if (isHullImpact) {
            // Distinct localized armor strike: incandescent white-gold core + molten amber/cyan rim
            meshSlot.ringMat.uniforms.uMode.value = 1.0;
            meshSlot.ringMat.uniforms.uColorInner.value.set('#fffbeb');
            meshSlot.ringMat.uniforms.uColorOuter.value.set(evt.color === '#fb923c' ? '#f97316' : '#fbbf24');
            meshSlot.coreMat.color.set('#fff7ed');
            meshSlot.flashMat.color.set('#fdba74');
          } else if (isPlayerHit) {
            meshSlot.ringMat.uniforms.uMode.value = 1.0;
            meshSlot.ringMat.uniforms.uColorInner.value.set('#fff7ed');
            meshSlot.ringMat.uniforms.uColorOuter.value.set('#fb923c');
            meshSlot.coreMat.color.set('#fed7aa');
            meshSlot.flashMat.color.set('#fb923c');
          } else {
            // Explosion
            meshSlot.ringMat.uniforms.uMode.value = 2.0;
            meshSlot.ringMat.uniforms.uColorInner.value.set('#fef3c7');
            meshSlot.ringMat.uniforms.uColorOuter.value.set('#38bdf8');
            meshSlot.coreMat.color.set('#fef3c7');
            meshSlot.flashMat.color.set('#f59e0b');
          }

          for (let i = 0; i < sparkCount; i++) {
            const p = particles[sparkCursor.current % sparkPoolLimit];
            sparkCursor.current += 1;
            p.active = true;
            p.position.copy(evt.position);
            p.age = 0;

            if (isShield) {
              // Deflected energy motes skimming tangentially across the shield barrier
              const angle = (i / sparkCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
              const tangentialSpeed = (isShieldBreak ? 24 : 16) + Math.random() * (isShieldBreak ? 34 : 22);
              const outwardLift = (isShieldBreak ? 8 : 3.5) + Math.random() * (isShieldBreak ? 14 : 7);
              const cosA = Math.cos(angle);
              const sinA = Math.sin(angle);
              p.velocity
                .set(0, 0, 0)
                .addScaledVector(_tangentA, cosA * tangentialSpeed)
                .addScaledVector(_tangentB, sinA * tangentialSpeed)
                .addScaledVector(_impactNormal, outwardLift);

              p.maxAge = isShieldBreak
                ? 0.24 + Math.random() * 0.20
                : 0.13 + Math.random() * 0.14;
              p.size = isShieldBreak ? 0.55 + Math.random() * 0.45 : 0.36 + Math.random() * 0.34;
              p.stretchFactor = 1.65;
              p.drag = 4.2;
              p.color.set(i % 3 === 0 ? '#ffffff' : i % 2 === 0 ? '#bae6fd' : '#38bdf8');
            } else if (isHullImpact) {
              // Directional armor-piercing sparks ejecting in a tight cone around the outward hull normal
              const angle = Math.random() * Math.PI * 2;
              const spread = 0.22 + Math.random() * 0.92;
              const speed = 22 + Math.random() * 44;
              const normalWeight = Math.cos(spread * 0.85);
              const tanWeight = Math.sin(spread * 0.85);
              p.velocity
                .set(0, 0, 0)
                .addScaledVector(_impactNormal, normalWeight * speed)
                .addScaledVector(_tangentA, Math.cos(angle) * tanWeight * speed)
                .addScaledVector(_tangentB, Math.sin(angle) * tanWeight * speed);

              p.maxAge = 0.18 + Math.random() * 0.20;
              p.size = 0.42 + Math.random() * 0.46;
              p.stretchFactor = 2.1;
              p.drag = 2.8;
              // Mostly incandescent molten gold/amber/orange armor sparks + 2 fast blue-white pulse plasma motes
              if (i < 2) {
                p.color.set('#e0f2fe');
              } else if (i % 3 === 0) {
                p.color.set('#fffbeb');
              } else if (i % 2 === 0) {
                p.color.set('#fbbf24');
              } else {
                p.color.set('#f97316');
              }
            } else if (isPlayerHit) {
              const u = Math.random() * 2 - 1;
              const theta = Math.random() * Math.PI * 2;
              const r = Math.sqrt(Math.max(0, 1 - u * u));
              const speed = 16 + Math.random() * 34;
              p.velocity.set(r * Math.cos(theta) * speed, u * speed, r * Math.sin(theta) * speed);
              p.maxAge = 0.18 + Math.random() * 0.18;
              p.size = 0.45 + Math.random() * 0.5;
              p.stretchFactor = 1.7;
              p.drag = 2.5;
              p.color.set(i % 2 === 0 ? '#fed7aa' : '#fb923c');
            } else {
              // Ship destruction explosion
              const u = Math.random() * 2 - 1;
              const theta = Math.random() * Math.PI * 2;
              const r = Math.sqrt(Math.max(0, 1 - u * u));
              const speed = 26 + Math.random() * 76;
              p.velocity.set(r * Math.cos(theta) * speed, u * speed, r * Math.sin(theta) * speed);
              p.maxAge = 0.42 + Math.random() * 0.50;
              p.size = 0.68 + Math.random() * 1.25;
              p.stretchFactor = 1.9;
              p.drag = 2.1;
              p.color.set(i % 3 === 0 ? '#67e8f9' : i % 2 === 0 ? '#fb923c' : '#fef3c7');
            }
          }
        },
        clear: () => {
          for (let i = 0; i < particles.length; i++) particles[i].active = false;
          for (let i = 0; i < shockwaves.length; i++) {
            shockwaves[i].active = false;
            shockMeshes[i].group.visible = false;
          }
        },
      }),
      [particles, shockMeshes, shockwaves],
    );

    useFrame((_, delta) => {
      const dt = Math.min(delta, 0.05);
      const pCoreMesh = playerBoltCoreRef.current;
      const pGlowMesh = playerBoltGlowRef.current;
      const pTrailMesh = playerBoltTrailRef.current;
      const eMesh = enemyBoltsRef.current;
      const sMesh = sparksRef.current;
      const mMesh = missilesRef.current;
      const mtMesh = missileTrailsRef.current;
      if (!pCoreMesh || !pGlowMesh || !pTrailMesh || !eMesh || !sMesh || !mMesh || !mtMesh) return;

      const gfx = graphicsRef.current;
      const glowStrength = gfx.postGlowEnabled ? 1.0 : 0.48;
      pulseGlowMat.uniforms.uGlowIntensity.value = glowStrength;
      pulseTrailMat.uniforms.uGlowIntensity.value = glowStrength;

      // 1. Update Instanced Player Pulse Bolts, Enemy Plasma Bolts, and Homing Missiles
      const items = combat.projectiles.items;
      for (let i = 0; i < MAX_POOLED_PROJECTILES; i++) {
        const proj = items[i];
        if (!active || !proj.active) {
          _dummy.scale.copy(_hiddenScale);
          _dummy.updateMatrix();
          pCoreMesh.setMatrixAt(i, _dummy.matrix);
          pGlowMesh.setMatrixAt(i, _dummy.matrix);
          pTrailMesh.setMatrixAt(i, _dummy.matrix);
          eMesh.setMatrixAt(i, _dummy.matrix);
          mMesh.setMatrixAt(i, _dummy.matrix);
          mtMesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }

        _quat.setFromUnitVectors(_upVec, proj.direction);

        if (proj.isHomingMissile) {
          // Homing missiles — preserved intact
          _dummy.position.copy(proj.position);
          _dummy.quaternion.copy(_quat);
          _dummy.scale.set(1.15, 1.15, 1.15);
          _dummy.updateMatrix();
          mMesh.setMatrixAt(i, _dummy.matrix);

          _dummy.position.copy(proj.position).addScaledVector(proj.direction, -1.65);
          _dummy.scale.set(0.9, Math.max(0.35, 0.8 + Math.sin(proj.age * 38) * 0.12), 0.9);
          _dummy.updateMatrix();
          mtMesh.setMatrixAt(i, _dummy.matrix);

          _dummy.scale.copy(_hiddenScale);
          _dummy.updateMatrix();
          pCoreMesh.setMatrixAt(i, _dummy.matrix);
          pGlowMesh.setMatrixAt(i, _dummy.matrix);
          pTrailMesh.setMatrixAt(i, _dummy.matrix);
          eMesh.setMatrixAt(i, _dummy.matrix);
        } else if (proj.isPlayerOwned) {
          // Player Pulse Cannon Bolt: concentrated blue-white core + soft outer plasma sheath + short clean trail
          const radiusScale = proj.boltRadius / 0.14;
          const boltLen = proj.boltLength * 1.2;

          // Distance traveled since muzzle spawn so bolt & trail never clip backward behind cannon barrels
          const speed = Math.max(120, proj.velocity.length());
          const traveled = proj.age * speed;
          const visibleBoltLen = Math.min(boltLen, Math.max(1.4, traveled + 1.4));
          const rearOffset = -visibleBoltLen * 0.44;

          // Layer A: Concentrated white-blue core
          _dummy.position.copy(proj.position);
          _dummy.quaternion.copy(_quat);
          _dummy.scale.set(radiusScale, visibleBoltLen, radiusScale);
          _dummy.updateMatrix();
          pCoreMesh.setMatrixAt(i, _dummy.matrix);

          // Layer B: Controlled outer plasma glow sheath
          const glowRadScale = radiusScale * (gfx.postGlowEnabled ? 1.06 : 0.78);
          _dummy.scale.set(glowRadScale, visibleBoltLen * 1.14, glowRadScale);
          _dummy.updateMatrix();
          pGlowMesh.setMatrixAt(i, _dummy.matrix);

          // Layer C: Short, clean tapered energy trail immediately behind core
          const targetTrailLen = Math.min(5.6, boltLen * 0.86);
          const trailLen = Math.min(targetTrailLen, Math.max(0, traveled - visibleBoltLen * 0.3));
          if (trailLen > 0.12) {
            _dummy.position.copy(proj.position).addScaledVector(proj.direction, rearOffset);
            _dummy.scale.set(radiusScale * 0.96, trailLen, radiusScale * 0.96);
            _dummy.updateMatrix();
            pTrailMesh.setMatrixAt(i, _dummy.matrix);
          } else {
            _dummy.scale.copy(_hiddenScale);
            _dummy.updateMatrix();
            pTrailMesh.setMatrixAt(i, _dummy.matrix);
          }

          // Hide enemy & missile slots for this index
          _dummy.scale.copy(_hiddenScale);
          _dummy.updateMatrix();
          eMesh.setMatrixAt(i, _dummy.matrix);
          mMesh.setMatrixAt(i, _dummy.matrix);
          mtMesh.setMatrixAt(i, _dummy.matrix);
        } else {
          // Enemy bolts — preserved intact
          _dummy.position.copy(proj.position);
          _dummy.quaternion.copy(_quat);
          _dummy.scale.set(proj.boltRadius * 8.2, proj.boltLength, proj.boltRadius * 8.2);
          _dummy.updateMatrix();
          eMesh.setMatrixAt(i, _dummy.matrix);

          _dummy.scale.copy(_hiddenScale);
          _dummy.updateMatrix();
          pCoreMesh.setMatrixAt(i, _dummy.matrix);
          pGlowMesh.setMatrixAt(i, _dummy.matrix);
          pTrailMesh.setMatrixAt(i, _dummy.matrix);
          mMesh.setMatrixAt(i, _dummy.matrix);
          mtMesh.setMatrixAt(i, _dummy.matrix);
        }
      }
      pCoreMesh.instanceMatrix.needsUpdate = true;
      pGlowMesh.instanceMatrix.needsUpdate = true;
      pTrailMesh.instanceMatrix.needsUpdate = true;
      eMesh.instanceMatrix.needsUpdate = true;
      mMesh.instanceMatrix.needsUpdate = true;
      mtMesh.instanceMatrix.needsUpdate = true;

      // 2. Update Pooled Velocity-Aligned Impact & Explosion Sparks
      let activeSparkCount = 0;
      for (let i = 0; i < MAX_SPARK_POOL; i++) {
        const p = particles[i];
        if (!active || !p.active) {
          _dummy.scale.copy(_hiddenScale);
          _dummy.updateMatrix();
          sMesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }

        p.age += dt;
        if (p.age >= p.maxAge) {
          p.active = false;
          _dummy.scale.copy(_hiddenScale);
          _dummy.updateMatrix();
          sMesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }

        activeSparkCount += 1;
        p.position.addScaledVector(p.velocity, dt);
        p.velocity.multiplyScalar(Math.exp(-p.drag * dt));

        const speed = p.velocity.length();
        const lifeRatio = 1 - p.age / p.maxAge;
        const widthScale = p.size * Math.pow(lifeRatio, 0.75);
        const lengthScale = widthScale * Math.min(3.4, 0.75 + speed * 0.028) * p.stretchFactor * 0.65;

        _dummy.position.copy(p.position);
        if (speed > 0.01) {
          _velDir.copy(p.velocity).divideScalar(speed);
          _quat.setFromUnitVectors(_upVec, _velDir);
          _dummy.quaternion.copy(_quat);
        } else {
          _dummy.quaternion.identity();
        }
        _dummy.scale.set(widthScale, Math.max(widthScale, lengthScale), widthScale);
        _dummy.updateMatrix();
        sMesh.setMatrixAt(i, _dummy.matrix);
        sMesh.setColorAt(i, p.color);
      }
      sMesh.instanceMatrix.needsUpdate = true;
      if (sMesh.instanceColor) sMesh.instanceColor.needsUpdate = true;

      // 3. Update Pooled Localized Impact & Shockwave Slots
      let activeShockCount = 0;
      for (let i = 0; i < MAX_SHOCKWAVE_POOL; i++) {
        const sw = shockwaves[i];
        const m = shockMeshes[i];
        if (!active || !sw.active) {
          m.group.visible = false;
          continue;
        }

        sw.age += dt;
        if (sw.age >= sw.maxAge) {
          sw.active = false;
          m.group.visible = false;
          continue;
        }

        activeShockCount += 1;
        const t = sw.age / sw.maxAge;
        const easeOut = 1 - Math.pow(1 - t, 3);
        m.group.visible = true;
        m.group.position.copy(sw.position);

        // Ring ripple / thermal breach plane
        const ringScale = sw.isHullImpact
          ? 0.55 + easeOut * sw.maxScale
          : 0.75 + easeOut * sw.maxScale;
        m.ring.scale.setScalar(ringScale);
        m.ringMat.uniforms.uProgress.value = t;
        m.ringMat.uniforms.uOpacity.value =
          Math.pow(1 - t, sw.isHullImpact ? 1.35 : 1.1) *
          (sw.isExplosion ? 0.85 : sw.isShield ? 0.96 : sw.isHullImpact ? 0.92 : 0.7);

        // Electric shield arcs — strictly for shield impacts & breaks, never hull impacts
        m.arcs.visible = sw.isShield && gfx.postGlowEnabled;
        if (m.arcs.visible) {
          m.arcs.scale.setScalar(ringScale * (sw.isShieldBreak ? 0.94 : 0.82));
          m.arcMat.opacity =
            Math.pow(1 - t, 1.55) * (0.72 + 0.28 * Math.sin(sw.age * 78 + sw.rollAngle));
        }

        // Compact core flash
        const coreScale = sw.isExplosion
          ? (0.6 + easeOut * sw.maxScale * 0.40) * (1 - t * 0.35)
          : sw.isHullImpact
            ? 0.22 + Math.pow(1 - t, 1.6) * 0.68
            : sw.isShieldBreak
              ? 0.45 + Math.pow(1 - t, 1.5) * 1.45
              : 0.26 + Math.pow(1 - t, 1.8) * 0.72;
        m.core.scale.setScalar(Math.max(0.01, coreScale));
        m.coreMat.opacity =
          Math.pow(1 - t, 1.85) * (sw.isExplosion ? 0.92 : sw.isHullImpact ? 0.88 : 0.78);

        // Controlled bloom glow sprite (compact on hits so targets stay clearly readable)
        m.flash.visible = gfx.postGlowEnabled;
        if (gfx.postGlowEnabled) {
          const spriteScale = sw.isExplosion
            ? sw.maxScale * (1.15 + easeOut * 0.85)
            : sw.isShieldBreak
              ? sw.maxScale * 1.15
              : sw.isShield
                ? sw.maxScale * 1.05
                : sw.maxScale * 0.95;
          m.flash.scale.setScalar(spriteScale);
          m.flashMat.opacity =
            Math.pow(1 - t, 1.55) *
            (sw.isExplosion ? 0.88 : sw.isShieldBreak ? 0.92 : sw.isShield ? 0.78 : 0.68);
        }
      }

      telemetryRef.current.activeParticles = activeSparkCount + activeShockCount;
    });

    return (
      <group name="combat-vfx">
        {/* Player Pulse Cannon Bolts: Core + Outer Glow Sheath + Short Energy Trail */}
        <instancedMesh
          ref={playerBoltTrailRef}
          args={[pulseTrailGeo, pulseTrailMat, MAX_POOLED_PROJECTILES]}
          frustumCulled={false}
          renderOrder={13}
        />
        <instancedMesh
          ref={playerBoltGlowRef}
          args={[pulseGlowGeo, pulseGlowMat, MAX_POOLED_PROJECTILES]}
          frustumCulled={false}
          renderOrder={14}
        />
        <instancedMesh
          ref={playerBoltCoreRef}
          args={[pulseCoreGeo, pulseCoreMat, MAX_POOLED_PROJECTILES]}
          frustumCulled={false}
          renderOrder={15}
        />

        {/* Preserved Homing Missiles & Enemy Plasma Bolts */}
        <instancedMesh
          ref={missilesRef}
          args={[missileGeo, missileMat, MAX_POOLED_PROJECTILES]}
          frustumCulled={false}
          renderOrder={15}
        />
        <instancedMesh
          ref={missileTrailsRef}
          args={[missileTrailGeo, missileTrailMat, MAX_POOLED_PROJECTILES]}
          frustumCulled={false}
          renderOrder={14}
        />
        <instancedMesh
          ref={enemyBoltsRef}
          args={[enemyBoltGeo, enemyBoltMat, MAX_POOLED_PROJECTILES]}
          frustumCulled={false}
          renderOrder={14}
        />

        {/* Velocity-Aligned Impact & Explosion Spark Streaks */}
        <instancedMesh
          ref={sparksRef}
          args={[sparkGeo, sparkMat, MAX_SPARK_POOL]}
          frustumCulled={false}
          renderOrder={16}
        />

        {/* Pooled Localized Shield Deflection / Hull Breach / Explosion Flashes */}
        <group ref={shockwaveGroupRef}>
          {shockMeshes.map((m, idx) => (
            <primitive key={idx} object={m.group} />
          ))}
        </group>
      </group>
    );
  },
);
