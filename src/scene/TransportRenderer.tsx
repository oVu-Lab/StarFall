import { useEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SHIP_CONFIGS } from '../config/ships';
import type { CombatManager } from '../engine/combat/CombatManager';
import { buildShipModel } from './shipGeometry';

export function TransportRenderer({ combat, visible }: { combat: CombatManager; visible: boolean }) {
  const rootRef = useRef<THREE.Group>(null);
  const shipRootRef = useRef<THREE.Group>(null);
  const config = useMemo(() => ({
    ...SHIP_CONFIGS.destroyer,
    colors: {
      hullPrimary: '#64748b', hullSecondary: '#334155', hullTrim: '#fbbf24',
      canopy: '#082f49', engineCore: '#fef3c7', engineGlow: '#f59e0b',
    },
  }), []);
  const handle = useMemo(() => buildShipModel(config, 256), [config]);
  const ring = useMemo(() => new THREE.RingGeometry(17, 18.5, 48), []);

  useEffect(() => () => { handle.dispose(); ring.dispose(); }, [handle, ring]);

  useFrame((state) => {
    const transport = combat.transport;
    if (rootRef.current) rootRef.current.visible = Boolean(visible && transport?.active);
    if (!transport) return;
    if (shipRootRef.current) {
      shipRootRef.current.position.copy(transport.position);
      shipRootRef.current.quaternion.copy(transport.quaternion);
    }
    handle.setDetailLevel?.(true);
    handle.updateVisuals(0.016, 0.35, 0.2, 0, 0, 0);
    const node = state.scene.getObjectByName('transport-escort-ring');
    if (node) {
      node.position.copy(transport.position);
      node.rotation.set(Math.PI / 2, 0, state.clock.elapsedTime * 0.25);
      const material = (node as THREE.Mesh).material as THREE.MeshBasicMaterial;
      material.opacity = transport.hitFlashTimer > 0 ? 0.9 : 0.42 + Math.sin(state.clock.elapsedTime * 3) * 0.12;
    }
  });

  return (
    <group ref={rootRef} name="friendly-transport" visible={false}>
      <group ref={shipRootRef}>
        <primitive object={handle.group} />
        <Html position={[0, 17, 0]} center distanceFactor={100}>
          <div className="whitespace-nowrap border border-amber-400/70 bg-[#090f1b]/90 px-2 py-1 font-mono text-[10px] font-semibold tracking-wider text-amber-200">
            FRIENDLY · {combat.transport?.callsign ?? 'TRANSPORT'}
          </div>
        </Html>
      </group>
      <mesh name="transport-escort-ring" geometry={ring}>
        <meshBasicMaterial color="#fbbf24" transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {combat.transport && combat.transport.route.length > 1 && (
        <mesh position={combat.transport.route[combat.transport.route.length - 1]}>
          <sphereGeometry args={[9, 16, 16]} />
          <meshBasicMaterial color="#fbbf24" wireframe transparent opacity={0.55} />
        </mesh>
      )}
    </group>
  );
}
