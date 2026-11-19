import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { FlightController } from '../engine/FlightController';
import type { FlightTelemetry } from '../types/game';

interface SpeedLinesVFXProps {
  flight: FlightController;
  telemetryRef: React.MutableRefObject<FlightTelemetry>;
  count: number;
  active: boolean;
}

const BOX_HALF = 58;
const BOX_SIZE = BOX_HALF * 2;

const _dummy = new THREE.Object3D();
const _velDir = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _baseColor = new THREE.Color('#7dd3fc');
const _boostColor = new THREE.Color('#e0f2fe');

/**
 * Instanced space-dust streaks & boost warp speed-lines.
 * Wraps seamlessly around the player ship with zero per-frame allocations.
 */
export function SpeedLinesVFX({ flight, telemetryRef, count, active }: SpeedLinesVFXProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const offsets = useMemo(() => {
    const arr = new Float32Array(count * 3);
    let seed = 13371;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (rand() - 0.5) * BOX_SIZE;
      arr[i * 3 + 1] = (rand() - 0.5) * BOX_SIZE;
      arr[i * 3 + 2] = (rand() - 0.5) * BOX_SIZE;
    }
    return arr;
  }, [count]);

  const geo = useMemo(() => new THREE.CylinderGeometry(0.032, 0.032, 1, 4, 1, true), []);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#7dd3fc',
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      geo.dispose();
      mat.dispose();
    };
  }, [geo, mat]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    if (!active) {
      mesh.visible = false;
      return;
    }

    const telemetry = telemetryRef.current;
    const speed = telemetry.speed;
    const boost = telemetry.boostIntensity;

    if (speed < 4 && boost < 0.05) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    const speedRatio = THREE.MathUtils.clamp(speed / Math.max(telemetry.maxSpeed, 1), 0, 2);
    mat.opacity = THREE.MathUtils.clamp(0.08 + speedRatio * 0.22 + boost * 0.45, 0.05, 0.78);
    mat.color.copy(_baseColor).lerp(_boostColor, boost);

    if (speed > 0.5) {
      _velDir.copy(flight.velocity).normalize();
    } else {
      _velDir.set(0, 0, -1).applyQuaternion(flight.quaternion).normalize();
    }
    _quat.setFromUnitVectors(_upVec, _velDir);

    const streakLen = 0.65 + speedRatio * 2.8 + boost * 7.8;
    const streakThickness = 0.7 + boost * 0.65;

    const px = flight.position.x;
    const py = flight.position.y;
    const pz = flight.position.z;

    for (let i = 0; i < count; i++) {
      const bx = offsets[i * 3];
      const by = offsets[i * 3 + 1];
      const bz = offsets[i * 3 + 2];

      // Wrap world-space anchor points into a local cube centered around the ship
      const wx = px + ((((bx - px + BOX_HALF) % BOX_SIZE) + BOX_SIZE) % BOX_SIZE) - BOX_HALF;
      const wy = py + ((((by - py + BOX_HALF) % BOX_SIZE) + BOX_SIZE) % BOX_SIZE) - BOX_HALF;
      const wz = pz + ((((bz - pz + BOX_HALF) % BOX_SIZE) + BOX_SIZE) % BOX_SIZE) - BOX_HALF;

      // Push particles slightly away from the immediate center cockpit corridor so they never clip the camera
      const dx = wx - px;
      const dy = wy - py;
      const dz = wz - pz;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < 36) {
        _dummy.scale.set(0, 0, 0);
      } else {
        _dummy.position.set(wx, wy, wz);
        _dummy.quaternion.copy(_quat);
        _dummy.scale.set(streakThickness, streakLen, streakThickness);
      }

      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geo, mat, count]}
      frustumCulled={false}
      renderOrder={12}
    />
  );
}
