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
  color: THREE.Color;
}

interface ShockwaveSlot {
  active: boolean;
  position: THREE.Vector3;
  age: number;
  maxAge: number;
  maxScale: number;
  isExplosion: boolean;
}

const _dummy = new THREE.Object3D();
const _upVec = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _hiddenScale = new THREE.Vector3(0, 0, 0);

/**
 * Pooled high-craft combat visual effects renderer:
 * - Instanced player & enemy plasma bolts
 * - Quality-scaled pooled spark & debris particles
 * - Pooled expanding shockwave & core detonation flashes
 * Zero per-frame allocations; reports active particle count to telemetryRef.
 */
export const CombatVFX = forwardRef<CombatVFXHandle, CombatVFXProps>(
  function CombatVFX({ combat, telemetryRef, active, graphics }, ref) {
    const playerBoltsRef = useRef<THREE.InstancedMesh>(null);
    const enemyBoltsRef = useRef<THREE.InstancedMesh>(null);
    const sparksRef = useRef<THREE.InstancedMesh>(null);
    const shockwaveGroupRef = useRef<THREE.Group>(null);

    const glowSpriteTex = useMemo(() => AssetManager.acquireGlowSprite(), []);

    useEffect(() => {
      return () => {
        AssetManager.releaseGlowSprite();
      };
    }, [glowSpriteTex]);

    const boltGeo = useMemo(() => new THREE.CylinderGeometry(0.14, 0.14, 1, 6, 1), []);
    const playerBoltMat = useMemo(
      () =>
        new THREE.MeshBasicMaterial({
          color: '#67e8f9',
          transparent: true,
          opacity: 0.96,
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

    const sparkGeo = useMemo(() => new THREE.OctahedronGeometry(0.32, 0), []);
    const sparkMat = useMemo(
      () =>
        new THREE.MeshBasicMaterial({
          color: '#ffffff',
          transparent: true,
          opacity: 0.92,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      [],
    );

    const shockSphereGeo = useMemo(() => new THREE.SphereGeometry(1, 14, 10), []);
    const shockRingGeo = useMemo(() => new THREE.RingGeometry(0.76, 1.0, 24), []);

    const particles = useMemo<SparkParticle[]>(() => {
      const arr: SparkParticle[] = [];
      for (let i = 0; i < MAX_SPARK_POOL; i++) {
        arr.push({
          active: false,
          position: new THREE.Vector3(),
          velocity: new THREE.Vector3(),
          age: 0,
          maxAge: 0.5,
          size: 1,
          color: new THREE.Color('#22d3ee'),
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
          position: new THREE.Vector3(),
          age: 0,
          maxAge: 0.6,
          maxScale: 16,
          isExplosion: true,
        });
      }
      return arr;
    }, []);
    const shockCursor = useRef(0);

    const shockMeshes = useMemo(() => {
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
        group.add(core);

        const ringMat = new THREE.MeshBasicMaterial({
          color: '#38bdf8',
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        const ring = new THREE.Mesh(shockRingGeo, ringMat);
        group.add(ring);

        const flashMat = new THREE.SpriteMaterial({
          map: glowSpriteTex,
          color: '#7dd3fc',
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const flash = new THREE.Sprite(flashMat);
        group.add(flash);

        return { group, core, coreMat, ring, ringMat, flash, flashMat };
      });
    }, [shockRingGeo, shockSphereGeo, glowSpriteTex]);

    const graphicsRef = useRef(graphics);
    graphicsRef.current = graphics;

    useEffect(() => {
      return () => {
        boltGeo.dispose();
        playerBoltMat.dispose();
        enemyBoltMat.dispose();
        sparkGeo.dispose();
        sparkMat.dispose();
        shockSphereGeo.dispose();
        shockRingGeo.dispose();
        for (const m of shockMeshes) {
          m.coreMat.dispose();
          m.ringMat.dispose();
          m.flashMat.dispose();
        }
      };
    }, [
      boltGeo,
      enemyBoltMat,
      playerBoltMat,
      shockMeshes,
      shockRingGeo,
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
          const baseCount = isExplosion ? 32 : 9;
          const sparkCount = Math.max(4, Math.round(baseCount * gfx.sparkScaleFactor));
          const sparkPoolLimit = Math.min(MAX_SPARK_POOL, gfx.maxSparkParticles);
          const shockPoolLimit = Math.min(MAX_SHOCKWAVE_POOL, gfx.maxShockwaves);

          const swIdx = shockCursor.current % shockPoolLimit;
          shockCursor.current += 1;
          const sw = shockwaves[swIdx];
          sw.active = true;
          sw.position.copy(evt.position);
          sw.age = 0;
          sw.maxAge = isExplosion ? 0.68 : 0.22;
          sw.maxScale = isExplosion ? 18 * evt.scale : 4.2 * evt.scale;
          sw.isExplosion = isExplosion;

          const meshSlot = shockMeshes[swIdx];
          meshSlot.ring.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI,
          );
          const accentColor =
            evt.kind === 'player-hit' ? '#fb923c' : isExplosion ? '#38bdf8' : '#22d3ee';
          meshSlot.ringMat.color.set(accentColor);
          meshSlot.flashMat.color.set(isExplosion ? '#f59e0b' : accentColor);
          meshSlot.coreMat.color.set(isExplosion ? '#fef3c7' : '#e0f2fe');

          for (let i = 0; i < sparkCount; i++) {
            const p = particles[sparkCursor.current % sparkPoolLimit];
            sparkCursor.current += 1;
            p.active = true;
            p.position.copy(evt.position);

            const u = Math.random() * 2 - 1;
            const theta = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.max(0, 1 - u * u));
            const speed = isExplosion
              ? 24 + Math.random() * 78
              : 14 + Math.random() * 38;
            p.velocity.set(r * Math.cos(theta) * speed, u * speed, r * Math.sin(theta) * speed);
            p.age = 0;
            p.maxAge = isExplosion ? 0.45 + Math.random() * 0.55 : 0.18 + Math.random() * 0.22;
            p.size = isExplosion ? 0.7 + Math.random() * 1.45 : 0.45 + Math.random() * 0.65;

            if (isExplosion) {
              p.color.set(i % 3 === 0 ? '#67e8f9' : i % 2 === 0 ? '#fb923c' : '#fef3c7');
            } else if (evt.kind === 'player-hit') {
              p.color.set('#fb923c');
            } else {
              p.color.set('#67e8f9');
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
      const pMesh = playerBoltsRef.current;
      const eMesh = enemyBoltsRef.current;
      const sMesh = sparksRef.current;
      if (!pMesh || !eMesh || !sMesh) return;

      const gfx = graphicsRef.current;

      // 1. Update Instanced Player & Enemy Energy Projectiles
      const items = combat.projectiles.items;
      for (let i = 0; i < MAX_POOLED_PROJECTILES; i++) {
        const proj = items[i];
        if (!active || !proj.active) {
          _dummy.scale.copy(_hiddenScale);
          _dummy.updateMatrix();
          pMesh.setMatrixAt(i, _dummy.matrix);
          eMesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }

        _quat.setFromUnitVectors(_upVec, proj.direction);
        _dummy.position.copy(proj.position);
        _dummy.quaternion.copy(_quat);

        if (proj.isPlayerOwned) {
          _dummy.scale.set(proj.boltRadius * 7.5, proj.boltLength, proj.boltRadius * 7.5);
          _dummy.updateMatrix();
          pMesh.setMatrixAt(i, _dummy.matrix);

          _dummy.scale.copy(_hiddenScale);
          _dummy.updateMatrix();
          eMesh.setMatrixAt(i, _dummy.matrix);
        } else {
          _dummy.scale.set(proj.boltRadius * 8.2, proj.boltLength, proj.boltRadius * 8.2);
          _dummy.updateMatrix();
          eMesh.setMatrixAt(i, _dummy.matrix);

          _dummy.scale.copy(_hiddenScale);
          _dummy.updateMatrix();
          pMesh.setMatrixAt(i, _dummy.matrix);
        }
      }
      pMesh.instanceMatrix.needsUpdate = true;
      eMesh.instanceMatrix.needsUpdate = true;

      // 2. Update Pooled Impact & Explosion Sparks
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
        p.velocity.multiplyScalar(Math.exp(-2.2 * dt));
        const lifeRatio = 1 - p.age / p.maxAge;
        const sc = p.size * lifeRatio;

        _dummy.position.copy(p.position);
        _dummy.rotation.set(p.age * 8, p.age * 6, 0);
        _dummy.scale.set(sc, sc * 1.8, sc);
        _dummy.updateMatrix();
        sMesh.setMatrixAt(i, _dummy.matrix);
        sMesh.setColorAt(i, p.color);
      }
      sMesh.instanceMatrix.needsUpdate = true;
      if (sMesh.instanceColor) sMesh.instanceColor.needsUpdate = true;

      // 3. Update Pooled Shockwave & Core Flash Slots
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

        const ringScale = 0.8 + easeOut * sw.maxScale;
        m.ring.scale.setScalar(ringScale);
        m.ringMat.opacity = (1 - t) * (sw.isExplosion ? 0.85 : 0.65);

        const coreScale = sw.isExplosion
          ? (0.6 + easeOut * sw.maxScale * 0.42) * (1 - t * 0.35)
          : 0.4 + (1 - t) * 1.8;
        m.core.scale.setScalar(Math.max(0.01, coreScale));
        m.coreMat.opacity = Math.pow(1 - t, 1.8) * (sw.isExplosion ? 0.92 : 0.72);

        m.flash.visible = gfx.postGlowEnabled;
        if (gfx.postGlowEnabled) {
          const spriteScale = sw.isExplosion
            ? sw.maxScale * (1.2 + easeOut * 0.9)
            : sw.maxScale * 1.4;
          m.flash.scale.setScalar(spriteScale);
          m.flashMat.opacity = Math.pow(1 - t, 1.4) * (sw.isExplosion ? 0.9 : 0.6);
        }
      }

      telemetryRef.current.activeParticles = activeSparkCount + activeShockCount;
    });

    return (
      <group name="combat-vfx">
        <instancedMesh
          ref={playerBoltsRef}
          args={[boltGeo, playerBoltMat, MAX_POOLED_PROJECTILES]}
          frustumCulled={false}
          renderOrder={14}
        />
        <instancedMesh
          ref={enemyBoltsRef}
          args={[boltGeo, enemyBoltMat, MAX_POOLED_PROJECTILES]}
          frustumCulled={false}
          renderOrder={14}
        />
        <instancedMesh
          ref={sparksRef}
          args={[sparkGeo, sparkMat, MAX_SPARK_POOL]}
          frustumCulled={false}
          renderOrder={15}
        />
        <group ref={shockwaveGroupRef}>
          {shockMeshes.map((m, idx) => (
            <primitive key={idx} object={m.group} />
          ))}
        </group>
      </group>
    );
  },
);
