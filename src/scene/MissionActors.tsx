import { useEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { CombatManager } from '../engine/combat/CombatManager';
import type { MissionManager } from '../engine/mission/MissionManager';

export function MissionActors({
  combat,
  missionManager,
  visible,
}: {
  combat: CombatManager;
  missionManager: MissionManager;
  visible: boolean;
}) {
  const relayRef = useRef<THREE.Group>(null);
  const extractionRef = useRef<THREE.Group>(null);
  const ring = useMemo(() => new THREE.RingGeometry(20, 23, 56), []);
  const beaconRing = useMemo(() => new THREE.RingGeometry(18, 20, 48), []);
  useEffect(() => () => {
    ring.dispose();
    beaconRing.dispose();
  }, [ring, beaconRing]);

  useFrame((state) => {
    const relay = combat.relay;
    if (relayRef.current) {
      relayRef.current.visible = Boolean(visible && relay);
      if (relay) relayRef.current.position.copy(relay.position);
      const core = relayRef.current.getObjectByName('relay-core') as THREE.Mesh | undefined;
      if (core) {
        const material = core.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = relay?.hitFlashTimer ? 2.4 : relay?.health.isDestroyed ? 0.08 : 0.65;
        material.color.set(relay?.health.isDestroyed ? '#334155' : '#22d3ee');
      }
    }
    const actors = missionManager.getWorldActors();
    if (extractionRef.current) {
      extractionRef.current.visible = Boolean(visible && actors?.extractionPoint);
      if (actors?.extractionPoint) extractionRef.current.position.copy(actors.extractionPoint.position);
      const marker = extractionRef.current.getObjectByName('extraction-ring') as THREE.Mesh | undefined;
      if (marker) marker.rotation.z = state.clock.elapsedTime * 0.32;
    }
  });

  return (
    <>
      <group ref={relayRef} visible={false}>
        <mesh name="relay-core">
          <octahedronGeometry args={[17, 1]} />
          <meshStandardMaterial color="#22d3ee" emissive="#0891b2" emissiveIntensity={0.65} metalness={0.55} roughness={0.3} />
        </mesh>
        <mesh geometry={ring} rotation={[Math.PI / 2, 0, 0]}>
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.58} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        {visible && <Html position={[0, 27, 0]} center distanceFactor={120}>
          <div className="whitespace-nowrap border border-cyan-400/70 bg-[#06121c]/90 px-2 py-1 font-mono text-[10px] font-semibold tracking-wider text-cyan-200">COBALT RELAY</div>
        </Html>}
      </group>

      <group ref={extractionRef} visible={false}>
        <mesh position={[0, 0, -15]}>
          <cylinderGeometry args={[7, 12, 24, 8, 1, true]} />
          <meshBasicMaterial color="#fbbf24" wireframe transparent opacity={0.62} />
        </mesh>
        <mesh name="extraction-ring" geometry={beaconRing} rotation={[Math.PI / 2, 0, 0]}>
          <meshBasicMaterial color="#fbbf24" transparent opacity={0.72} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        {visible && <Html position={[0, 24, 0]} center distanceFactor={100}>
          <div className="whitespace-nowrap border border-amber-400/75 bg-[#171205]/90 px-2 py-1 font-mono text-[10px] font-semibold tracking-wider text-amber-200">EXTRACTION BEACON</div>
        </Html>}
      </group>
    </>
  );
}
