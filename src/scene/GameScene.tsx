import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import type { GraphicsPreset } from '../config/graphics';
import { getShipConfigWithSkin } from '../config/collection';
import { AssetManager } from '../engine/AssetManager';
import { CameraController } from '../engine/CameraController';
import { PLAYER_ENTITY_ID, type CombatManager, type VfxBurstEvent } from '../engine/combat/CombatManager';
import type { FlightController } from '../engine/FlightController';
import type { InputManager } from '../engine/InputManager';
import type { MissionManager } from '../engine/mission/MissionManager';
import type {
  FlightTelemetry,
  GamePhase,
  GameSettings,
  MenuSection,
  ShipId,
} from '../types/game';
import type { MissionEnvironmentTheme } from '../types/mission';
import { CombatVFX, type CombatVFXHandle } from './CombatVFX';
import { EnemyShipRenderer } from './EnemyShipRenderer';
import { PulseCannonVFX } from './PulseCannonVFX';
import { buildShipModel } from './shipGeometry';
import { buildVanguardModel } from './vanguardModel';
import { SpaceEnvironment } from './SpaceEnvironment';
import { SpeedLinesVFX } from './SpeedLinesVFX';
import { TransportRenderer } from './TransportRenderer';
import { MissionActors } from './MissionActors';
import {
  consumeShieldImpacts,
  createShieldField,
  createShieldSurfaceHit,
  disposeShieldField,
  projectOntoShieldSurface,
  queueShieldImpact,
  updateShieldField,
} from './ShieldField';

interface GameSceneProps {
  phase: GamePhase;
  menuSection: MenuSection;
  activeShipId: ShipId;
  hangarShipId: ShipId;
  activeSkinId: string;
  hangarSkinId: string;
  flight: FlightController;
  combat: CombatManager;
  missionManager: MissionManager;
  missionTheme: MissionEnvironmentTheme;
  input: InputManager;
  settingsRef: React.MutableRefObject<GameSettings>;
  telemetryRef: React.MutableRefObject<FlightTelemetry>;
  graphics: GraphicsPreset;
  hangarOrbitRef: React.MutableRefObject<{ yaw: number; pitch: number }>;
  snapCameraSignal: number;
  onPlayerDestroyed: () => void;
}

const _showcaseOrigin = new THREE.Vector3(0, 12, 40);

// Scratch objects for snapping player shield impacts onto the real shield skin (no per-hit allocations)
const _playerShieldHit = createShieldSurfaceHit();
let _playerShieldHitValid = false;
const _anchorLocalPos = new THREE.Vector3();
const _anchorLocalNormal = new THREE.Vector3();
const _anchorInv = new THREE.Matrix4();
const _anchorNormalMat = new THREE.Matrix3();
const _vfxAnchor = { localPosition: _anchorLocalPos, localNormal: _anchorLocalNormal };
const _snappedBurst: VfxBurstEvent = { kind: 'shield-hit', position: _playerShieldHit.position, color: '', scale: 1 };

export function GameScene({
  phase,
  menuSection,
  activeShipId,
  hangarShipId,
  activeSkinId,
  hangarSkinId,
  flight,
  combat,
  missionManager,
  missionTheme,
  input,
  settingsRef,
  telemetryRef,
  graphics,
  hangarOrbitRef,
  snapCameraSignal,
  onPlayerDestroyed,
}: GameSceneProps) {
  const { camera, gl } = useThree();
  const shipRootRef = useRef<THREE.Group>(null);
  const shipBankRef = useRef<THREE.Group>(null);
  const vfxRef = useRef<CombatVFXHandle>(null);
  const cameraController = useMemo(() => new CameraController(), []);

  // Display the inspected ship while in Hangar, otherwise the active flight ship
  const displayedShipId = phase === 'menu' && menuSection === 'hangar' ? hangarShipId : activeShipId;
  const displayedSkinId = phase === 'menu' && menuSection === 'hangar' ? hangarSkinId : activeSkinId;
  const displayedShipConfig = useMemo(() => getShipConfigWithSkin(displayedShipId, displayedSkinId), [displayedShipId, displayedSkinId]);

  const shipHandle = useMemo(
    () =>
      displayedShipConfig.id === 'interceptor'
        ? buildVanguardModel(displayedShipConfig, graphics.textureResolution)
        : buildShipModel(displayedShipConfig, graphics.textureResolution),
    [displayedShipConfig, graphics.textureResolution],
  );
  const shieldField = useMemo(
    () => createShieldField('#22d3ee', shipHandle.group),
    [shipHandle],
  );
  useEffect(() => () => disposeShieldField(shieldField), [shieldField]);
  const shieldFieldRef = useRef(shieldField);
  shieldFieldRef.current = shieldField;

  useEffect(() => {
    shipHandle.setDetailLevel?.(graphics.postGlowEnabled);
  }, [shipHandle, graphics.postGlowEnabled]);

  useEffect(() => {
    return () => {
      shipHandle.dispose();
    };
  }, [shipHandle]);

  // Wire CombatManager callbacks to procedural audio, pooled 3D VFX, and MissionManager
  useEffect(() => {
    combat.setCallbacks({
      onPlayerFire: () => {
        AudioManager.playPlayerLaser();
      },
      onEnemyFire: (evt) => {
        const dist = flight.position.distanceTo(evt.origin);
        AudioManager.playEnemyLaser(dist);
      },
      onDamage: (evt) => {
        missionManager.handleDamage(evt);
        if ((evt.shieldDamage ?? 0) > 0) {
          // Player hits: ripple centre is the point snapped onto the real shield skin (see onVfxBurst)
          const ripplePoint = evt.targetId === PLAYER_ENTITY_ID && _playerShieldHitValid
            ? _playerShieldHit.surface
            : evt.hitPoint;
          queueShieldImpact(evt.targetId, ripplePoint, Math.min(1.2, 0.55 + (evt.shieldDamage ?? 0) / 40));
          if (evt.targetId === PLAYER_ENTITY_ID) _playerShieldHitValid = false;
        }
        if (evt.targetId === PLAYER_ENTITY_ID) {
          if ((evt.shieldDamage ?? 0) > 0 && (evt.hullDamage ?? 0) === 0) AudioManager.playShieldHit();
          else AudioManager.playPlayerDamage();
        } else {
          AudioManager.playImpactHit(evt.destroyed);
        }
      },
      onShieldBreak: (_entityId, isPlayer) => {
        if (isPlayer) AudioManager.playShieldBreak();
      },
      onDestruction: (evt) => {
        const dist = flight.position.distanceTo(evt.position);
        AudioManager.playExplosion(dist);
        missionManager.handleDestruction(evt);
        if (evt.entityId === PLAYER_ENTITY_ID) {
          onPlayerDestroyed();
        }
      },
      onVfxBurst: (evt) => {
        const isPlayerShieldBurst =
          evt.targetId === PLAYER_ENTITY_ID && (evt.kind === 'shield-hit' || evt.kind === 'shield-break');
        const root = shipRootRef.current;
        const bank = shipBankRef.current;
        if (isPlayerShieldBurst && root && bank) {
          // The hit was resolved against this frame's flight pose, but the ship meshes are only moved later in
          // the frame. Sync the (idempotent) ship transform so the shield mesh matches the collision data.
          root.position.copy(flight.position);
          root.quaternion.copy(flight.quaternion);
          bank.rotation.set(0, 0, flight.visualBankAngle);
          const shield = shieldFieldRef.current;
          _playerShieldHitValid = projectOntoShieldSurface(
            shield,
            evt.hitPoint ?? evt.position,
            evt.direction,
            _playerShieldHit,
          );
          if (_playerShieldHitValid) {
            // Shield-local placement so the effect rides the surface as the ship moves/rotates/rolls
            _anchorInv.copy(shield.matrixWorld).invert();
            _anchorLocalPos.copy(_playerShieldHit.position).applyMatrix4(_anchorInv);
            // world->local normal transform is the transpose of the (rotation-dominant) local->world 3x3
            _anchorNormalMat.setFromMatrix4(shield.matrixWorld).transpose();
            _anchorLocalNormal.copy(_playerShieldHit.normal).applyMatrix3(_anchorNormalMat).normalize();
            _snappedBurst.kind = evt.kind;
            _snappedBurst.color = evt.color;
            _snappedBurst.scale = evt.scale;
            _snappedBurst.normal = _playerShieldHit.normal;
            _snappedBurst.weaponId = evt.weaponId;
            vfxRef.current?.spawnBurst(_snappedBurst, _vfxAnchor);
            return;
          }
        }
        vfxRef.current?.spawnBurst(evt);
      },
    });
  }, [combat, flight, missionManager, onPlayerDestroyed]);

  // A session reset snaps the chase camera; resuming must not reset the aligned view.
  useEffect(() => {
    vfxRef.current?.clear();
    if (phase === 'playing' && camera instanceof THREE.PerspectiveCamera) {
      cameraController.snapToShip(flight, camera, settingsRef.current.cameraDistance);
    }
  }, [snapCameraSignal, camera, cameraController, flight, settingsRef]);

  // Sync camera draw distance when graphics settings change
  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.far = graphics.drawDistance;
      camera.updateProjectionMatrix();
    }
  }, [camera, graphics.drawDistance]);

  const perfRef = useRef({ frames: 0, elapsed: 0 });

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const telemetry = telemetryRef.current;
    const settings = settingsRef.current;

    // Performance metrics update (every 250ms, zero React re-renders)
    perfRef.current.frames += 1;
    perfRef.current.elapsed += delta;
    if (perfRef.current.elapsed >= 0.25) {
      const avgFrameSec = perfRef.current.elapsed / perfRef.current.frames;
      telemetry.fps = Math.round(1 / Math.max(avgFrameSec, 0.001));
      telemetry.frameTimeMs = avgFrameSec * 1000;
      telemetry.drawCalls = gl.info.render.calls;
      telemetry.triangles = gl.info.render.triangles;
      const diag = AssetManager.getDiagnostics();
      telemetry.lastAssetLoadMs = diag.lastLoadDurationMs;
      telemetry.cachedAssetCount = diag.cachedResources;
      perfRef.current.frames = 0;
      perfRef.current.elapsed = 0;
    }

    if (phase === 'playing') {
      const snapshot = input.consumeSnapshot(dt, settings);
      const playerAlive = !combat.playerHealth.isDestroyed;

      if (playerAlive) {
        flight.update(dt, snapshot, settings, telemetry, state.size.width, state.size.height, camera instanceof THREE.PerspectiveCamera ? camera : undefined);

        if (flight.getBoostJustEngaged()) {
          AudioManager.playBoostEngage();
        }
      }

      // Advance chase camera first so 3D-to-HUD projections match the exact camera frame
      if (camera instanceof THREE.PerspectiveCamera) {
        cameraController.updateChase(
          dt,
          flight,
          camera,
          settings,
          playerAlive ? telemetry.boostIntensity : 0,
          state.clock.elapsedTime,
          combat.getCameraImpulse(),
        );
        camera.updateMatrixWorld();

        // The reticle is the actual cannon ray projected through this completed chase-camera
        // frame. Keep this between camera motion and combat so the HUD, target ranking, and
        // firing ray all share one projection model.
        flight.syncAimProjection(camera, telemetry, state.size.width, state.size.height);
      }

      // Advance combat simulation (weapons, projectiles, AI, collisions, HUD projections)
      combat.update(
        dt,
        flight,
        snapshot,
        telemetry,
        camera instanceof THREE.PerspectiveCamera ? camera : undefined,
      );

      // Advance mission objectives, wave triggers, and completion detection
      missionManager.update(dt, combat, flight.position, Boolean(snapshot.interactHeld));

      if (shipRootRef.current) {
        shipRootRef.current.visible = playerAlive;
        shipRootRef.current.position.copy(flight.position);
        shipRootRef.current.quaternion.copy(flight.quaternion);
      }
      consumeShieldImpacts(PLAYER_ENTITY_ID, shieldField);
      updateShieldField(shieldField, combat.playerShield, state.clock.elapsedTime, dt);
      shieldField.visible = playerAlive && shieldField.visible;
      if (shipBankRef.current) {
        shipBankRef.current.rotation.set(0, 0, flight.visualBankAngle);
      }

      const speedRatio = telemetry.speed / Math.max(telemetry.maxSpeed, 1);
      if (shipRootRef.current) {
        shieldField.updateWorldMatrix(true, false);
        vfxRef.current?.updateAnchored(shieldField.matrixWorld);
      }
      shipHandle.updateVisuals(
        dt,
        speedRatio,
        telemetry.boostIntensity,
        telemetry.yawRate,
        telemetry.pitchRate,
        telemetry.rollRate,
      );

      if (playerAlive) {
        AudioManager.updateFlightAudio(speedRatio, telemetry.boostIntensity, telemetry.throttle);
      } else {
        AudioManager.setFlightAudioActive(false);
      }
      return;
    }

    if (phase === 'paused' || phase === 'results') {
      if (shipRootRef.current) {
        shipRootRef.current.visible = !combat.playerHealth.isDestroyed;
        shipRootRef.current.position.copy(flight.position);
        shipRootRef.current.quaternion.copy(flight.quaternion);
      }
      consumeShieldImpacts(PLAYER_ENTITY_ID, shieldField);
      updateShieldField(shieldField, combat.playerShield, state.clock.elapsedTime, dt);
      shieldField.visible = combatVisible && !combat.playerHealth.isDestroyed && shieldField.visible;
      shipHandle.updateVisuals(dt * 0.25, 0.2, 0, 0, 0, 0);
      return;
    }

    // Menu, Hangar, Mission Select, or Loading showcase mode
    const t = state.clock.elapsedTime;
    shieldField.visible = false;
    const hoverY = _showcaseOrigin.y + Math.sin(t * 1.15) * 0.28;

    if (shipRootRef.current) {
      shipRootRef.current.visible = true;
      shipRootRef.current.position.set(_showcaseOrigin.x, hoverY, _showcaseOrigin.z);
      shipRootRef.current.quaternion.setFromEuler(
        new THREE.Euler(Math.sin(t * 0.7) * 0.04, 0, Math.cos(t * 0.85) * 0.06),
      );
    }
    if (shipBankRef.current) {
      shipBankRef.current.rotation.set(0, 0, 0);
    }

    shipHandle.updateVisuals(dt, 0.32, menuSection === 'hangar' ? 0.18 : 0.12, 0, 0, 0);

    if (camera instanceof THREE.PerspectiveCamera) {
      const mode = menuSection === 'hangar' ? 'hangar' : 'menu';
      cameraController.updateShowcase(
        dt,
        _showcaseOrigin,
        camera,
        mode,
        mode === 'hangar' ? hangarOrbitRef.current.yaw : 0,
        mode === 'hangar' ? hangarOrbitRef.current.pitch : 0,
      );
    }
  });

  const combatVisible = phase === 'playing' || phase === 'paused' || phase === 'results';

  return (
    <>
      <SpaceEnvironment graphics={graphics} theme={missionTheme} />

      <group ref={shipRootRef} position={[0, 12, 40]}>
        <group ref={shipBankRef}>
          <primitive object={shipHandle.group} />
          <primitive object={shieldField} />
          <PulseCannonVFX
            telemetryRef={telemetryRef}
            shipId={displayedShipId}
            active={phase === 'playing' && !combat.playerHealth.isDestroyed}
            showcase={phase !== 'playing'}
            graphics={graphics}
          />
        </group>
      </group>

      <EnemyShipRenderer
        combat={combat}
        visible={combatVisible}
        graphics={graphics}
        playerPosition={flight.position}
      />

      <TransportRenderer combat={combat} visible={combatVisible} />

      <MissionActors combat={combat} missionManager={missionManager} visible={combatVisible} />

      <CombatVFX
        ref={vfxRef}
        combat={combat}
        telemetryRef={telemetryRef}
        active={combatVisible}
        graphics={graphics}
      />

      <SpeedLinesVFX
        flight={flight}
        telemetryRef={telemetryRef}
        count={graphics.speedLineCount}
        active={phase === 'playing' && !combat.playerHealth.isDestroyed}
      />
    </>
  );
}
