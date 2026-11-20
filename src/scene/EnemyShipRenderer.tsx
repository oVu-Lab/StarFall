import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GraphicsPreset } from '../config/graphics';
import { SHIP_CONFIGS } from '../config/ships';
import { AssetManager } from '../engine/AssetManager';
import { MAX_ENEMIES, type CombatManager } from '../engine/combat/CombatManager';
import type { ShipConfig, ShipVisualHandle } from '../types/game';
import { buildShipModel } from './shipGeometry';
import { consumeShieldImpacts, createShieldField, disposeShieldField, updateShieldField } from './ShieldField';

interface EnemyShipRendererProps {
  combat: CombatManager;
  visible: boolean;
  graphics: GraphicsPreset;
  playerPosition: THREE.Vector3;
}

function createHostileShipConfig(base: ShipConfig): ShipConfig {
  return {
    ...base,
    colors: {
      hullPrimary: '#1c1f2b',
      hullSecondary: '#0c0e16',
      hullTrim: '#f97316',
      canopy: '#1f0c14',
      engineCore: '#fef3c7',
      engineGlow: '#ef4444',
    },
  };
}

interface PooledEnemySlot {
  root: THREE.Group;
  bankGroup: THREE.Group;
  handle: ShipVisualHandle;
  hitGlowSprite: THREE.Sprite;
  hitGlowMat: THREE.SpriteMaterial;
  shieldField: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
}

/**
 * Pooled zero-re-render renderer for active enemy combat fighters.
 * Applies distance-based LOD culling of dynamic engine point lights and glow sprites
 * to keep fragment shader lighting cost tightly bounded during multi-enemy dogfights.
 */
export function EnemyShipRenderer({
  combat,
  visible,
  graphics,
  playerPosition,
}: EnemyShipRendererProps) {
  const glowSpriteTex = useMemo(() => AssetManager.acquireGlowSprite(), []);

  useEffect(() => {
    return () => {
      AssetManager.releaseGlowSprite();
    };
  }, [glowSpriteTex]);

  const slots = useMemo<PooledEnemySlot[]>(() => {
    const hostileConfigs: ShipConfig[] = [
      createHostileShipConfig(SHIP_CONFIGS.striker),
      createHostileShipConfig(SHIP_CONFIGS.interceptor),
      createHostileShipConfig(SHIP_CONFIGS.striker),
      createHostileShipConfig(SHIP_CONFIGS.destroyer),
      createHostileShipConfig(SHIP_CONFIGS.interceptor),
      createHostileShipConfig(SHIP_CONFIGS.striker),
    ];

    const list: PooledEnemySlot[] = [];
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const root = new THREE.Group();
      root.visible = false;
      const bankGroup = new THREE.Group();
      const handle = buildShipModel(
        hostileConfigs[i % hostileConfigs.length],
        graphics.textureResolution,
      );
      bankGroup.add(handle.group);
      root.add(bankGroup);

      const hitGlowMat = new THREE.SpriteMaterial({
        map: glowSpriteTex,
        color: '#67e8f9',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const hitGlowSprite = new THREE.Sprite(hitGlowMat);
      hitGlowSprite.scale.set(3.6, 3.6, 1);
      root.add(hitGlowSprite);
      const shieldField = createShieldField('#fb923c', handle.group);
      bankGroup.add(shieldField);

      list.push({ root, bankGroup, handle, hitGlowSprite, hitGlowMat, shieldField });
    }
    return list;
  }, [graphics.textureResolution, glowSpriteTex]);

  useEffect(() => {
    return () => {
      for (const s of slots) {
        s.handle.dispose();
        s.hitGlowMat.dispose();
        disposeShieldField(s.shieldField);
      }
    };
  }, [slots]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const enemies = combat.enemies;
    const lodDistSq = graphics.enemyLightLodDistance * graphics.enemyLightLodDistance;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const enemy = enemies[i];

      if (!visible || !enemy || !enemy.active || enemy.health.isDestroyed) {
        slot.root.visible = false;
        continue;
      }

      slot.root.visible = true;
      slot.root.position.copy(enemy.position);
      slot.root.quaternion.copy(enemy.quaternion);
      slot.bankGroup.rotation.set(0, 0, enemy.visualBankAngle);
      consumeShieldImpacts(enemy.id, slot.shieldField);
      updateShieldField(slot.shieldField, enemy.shield, state.clock.elapsedTime, dt);

      // Distance-based LOD: disable dynamic PointLight & engine flare sprites on distant ships
      const distSq = enemy.position.distanceToSquared(playerPosition);
      slot.handle.setDetailLevel?.(graphics.postGlowEnabled && distSq <= lodDistSq);

      const speedRatio = enemy.velocity.length() / 90;
      const boostVisual = enemy.aiState === 'evade' || enemy.aiState === 'reposition' ? 0.85 : 0.25;
      slot.handle.updateVisuals(dt, speedRatio, boostVisual, 0, 0, 0);

      // Subtle compact radial hit glint (cyan on shielded hull, warm amber on bare armor)
      if (enemy.hitFlashTimer > 0 && graphics.postGlowEnabled) {
        slot.hitGlowSprite.visible = true;
        slot.hitGlowMat.color.set(enemy.shield.current > 0 ? '#67e8f9' : '#fdba74');
        slot.hitGlowMat.opacity = Math.min(0.36, enemy.hitFlashTimer * 2.6);
        const s = 3.1 + enemy.hitFlashTimer * 6.5;
        slot.hitGlowSprite.scale.set(s, s, 1);
      } else {
        slot.hitGlowSprite.visible = false;
        slot.hitGlowMat.opacity = 0;
      }
    }
  });

  return (
    <group name="enemy-fleet">
      {slots.map((slot, idx) => (
        <primitive key={idx} object={slot.root} />
      ))}
    </group>
  );
}
