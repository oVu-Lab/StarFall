import * as THREE from 'three';
import { BOT_PERSONALITIES } from '../../config/botPersonalities';
import { WEAPON_CONFIGS } from '../../config/weapons';
import type {
  CombatStats,
  DamageEvent,
  DestructionEvent,
  EnemyEntity,
  HealthState,
  ProjectedEnemyMarker,
  WeaponConfig,
  WeaponFireEvent,
} from '../../types/combat';
import { DIFFICULTY_PROFILES } from '../../config/difficulty';
import type { BotPersonality, FlightTelemetry } from '../../types/game';
import type { DifficultyLevel, MissionWaveDefinition } from '../../types/mission';
import type { FlightController } from '../FlightController';
import type { InputSnapshot } from '../InputManager';
import { intersectSegmentSphere, intersectSphereSphere } from './CollisionSystem';
import { EnemyAIController } from './EnemyAIController';
import { applyDamage, createHealthState, getHealthRatio, resetHealthState } from './HealthSystem';
import { ProjectilePool } from './ProjectilePool';

export const PLAYER_ENTITY_ID = 'player-1';
export const PLAYER_COLLISION_RADIUS = 3.2;
export const ENEMY_COLLISION_RADIUS = 3.6;
export const MAX_ENEMIES = 6;

export interface VfxBurstEvent {
  kind: 'impact' | 'explosion' | 'player-hit';
  position: THREE.Vector3;
  color: string;
  scale: number;
}

export interface CombatCallbacks {
  onPlayerFire?: (evt: WeaponFireEvent) => void;
  onEnemyFire?: (evt: WeaponFireEvent) => void;
  onDamage?: (evt: DamageEvent) => void;
  onDestruction?: (evt: DestructionEvent) => void;
  onVfxBurst?: (evt: VfxBurstEvent) => void;
}

// Reusable scratch math helpers (zero per-frame GC allocations)
const _aimDir = new THREE.Vector3();
const _aimTarget = new THREE.Vector3();
const _muzzleLocal = new THREE.Vector3();
const _muzzleWorld = new THREE.Vector3();
const _fireDir = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _sepVec = new THREE.Vector3();
const _projVec = new THREE.Vector3();
const _leadWorld = new THREE.Vector3();
const _rightVec = new THREE.Vector3();
const _upVec = new THREE.Vector3();
const _forwardVec = new THREE.Vector3();

const CALLSIGN_POOL = [
  'VEX-01',
  'KRAKEN-2',
  'SHARD-4',
  'TALON-7',
  'RAVEN-3',
  'SPECTER-9',
];

/**
 * Central combat simulation coordinator.
 * Owns player weapon firing, pooled projectiles, swept collision detection,
 * enemy AI waves, health/damage state, and multiplayer-ready event hooks.
 */
export class CombatManager {
  public readonly projectiles = new ProjectilePool(160);
  public readonly enemies: EnemyEntity[] = [];
  public readonly playerHealth: HealthState;
  public readonly stats: CombatStats = {
    kills: 0,
    shotsFired: 0,
    shotsHit: 0,
    damageDealt: 0,
    damageTaken: 0,
    score: 0,
    wave: 1,
    activeEnemies: 0,
  };

  private readonly ai = new EnemyAIController();
  private playerWeapon: WeaponConfig = WEAPON_CONFIGS.player_pulse_twin;
  private playerWeaponCooldown = 0;
  private playerMuzzleIndex = 0;
  private simTime = 0;
  private waveRespawnTimer = 0;
  private enemyIdCounter = 1;
  private missionMode = false;
  private callbacks: CombatCallbacks = {};

  // Short-lived HUD & visual feedback timers
  private hitMarkerTimer = 0;
  private killMarkerTimer = 0;
  private damageFlashTimer = 0;
  private muzzleFlashLeft = 0;
  private muzzleFlashRight = 0;
  private cameraImpulse = 0;
  private primaryTargetId: string | null = null;

  public constructor(playerMaxHull: number) {
    this.playerHealth = createHealthState(playerMaxHull);
  }

  public setCallbacks(callbacks: CombatCallbacks): void {
    this.callbacks = callbacks;
  }

  public getWeaponConfig(): WeaponConfig {
    return this.playerWeapon;
  }

  public getCameraImpulse(): number {
    return this.cameraImpulse;
  }

  public getActiveEnemyCount(): number {
    let count = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i].active && !this.enemies[i].health.isDestroyed) count += 1;
    }
    return count;
  }

  public getActiveProjectileCount(): number {
    return this.projectiles.getActiveCount();
  }

  public clearCombatState(playerMaxHull: number, missionMode: boolean): void {
    this.missionMode = missionMode;
    resetHealthState(this.playerHealth, playerMaxHull);
    this.projectiles.clear();
    this.enemies.length = 0;
    this.playerWeaponCooldown = 0;
    this.playerMuzzleIndex = 0;
    this.simTime = 0;
    this.waveRespawnTimer = 0;
    this.hitMarkerTimer = 0;
    this.killMarkerTimer = 0;
    this.damageFlashTimer = 0;
    this.muzzleFlashLeft = 0;
    this.muzzleFlashRight = 0;
    this.cameraImpulse = 0;
    this.primaryTargetId = null;

    this.stats.kills = 0;
    this.stats.shotsFired = 0;
    this.stats.shotsHit = 0;
    this.stats.damageDealt = 0;
    this.stats.damageTaken = 0;
    this.stats.score = 0;
    this.stats.wave = 1;
    this.stats.activeEnemies = 0;
  }

  public resetSession(playerMaxHull: number, playerPos: THREE.Vector3): void {
    this.clearCombatState(playerMaxHull, false);
    this.spawnWave(1, playerPos);
  }

  public spawnMissionWave(
    wave: MissionWaveDefinition,
    difficulty: DifficultyLevel,
    difficultyNumeric: number,
    aroundPos: THREE.Vector3,
  ): void {
    this.missionMode = true;
    this.enemies.length = 0;
    this.stats.wave = wave.waveNumber;
    const diffProfile = DIFFICULTY_PROFILES[difficulty];

    for (let i = 0; i < wave.enemies.length && i < MAX_ENEMIES; i++) {
      const spec = wave.enemies[i];
      const pCfg = BOT_PERSONALITIES[spec.personality];
      const spawnPos = new THREE.Vector3(
        aroundPos.x + spec.offset[0],
        aroundPos.y + spec.offset[1],
        aroundPos.z + spec.offset[2],
      );
      const id = `enemy-${this.enemyIdCounter++}`;
      const maxHull = pCfg.maxHull + (spec.hullBonus ?? 0);

      const enemy: EnemyEntity = {
        id,
        callsign: spec.callsign,
        shipId: spec.shipId,
        personality: spec.personality,
        difficulty: difficultyNumeric,
        difficultyLevel: difficulty,
        isPriorityTarget: Boolean(spec.isPriorityTarget),
        active: true,
        position: spawnPos,
        quaternion: new THREE.Quaternion(),
        velocity: new THREE.Vector3(0, 0, 18),
        visualBankAngle: 0,
        collisionRadius: ENEMY_COLLISION_RADIUS,
        health: createHealthState(maxHull),
        aiState: 'patrol',
        aiStateTimer: 0.3 + i * 0.18,
        reactionTimer: pCfg.reactionTime * diffProfile.reactionTimeScale,
        coordinationTimer: diffProfile.coordinationIntervalSec * (0.65 + i * 0.2),
        weaponCooldown: 0.75 + i * 0.28,
        burstTimer: 1.0 * diffProfile.burstPressureScale,
        burstActive: true,
        muzzleIndex: 0,
        patrolAnchor: spawnPos.clone(),
        patrolAngle: i * 1.7,
        flankSign: i % 2 === 0 ? 1 : -1,
        evadeDir: new THREE.Vector3(1, 0, 0),
        repositionPoint: spawnPos.clone(),
        hitFlashTimer: 0,
        muzzleFlashTimer: 0,
      };
      this.enemies.push(enemy);
    }

    this.stats.activeEnemies = this.enemies.length;
  }

  public spawnWave(waveNumber: number, aroundPos: THREE.Vector3): void {
    this.enemies.length = 0;
    this.stats.wave = waveNumber;

    // Progressive combat roster showcasing Aggressor, Flanker, Defender, and Ace personalities
    const roster: Array<{ personality: BotPersonality; difficulty: number; offset: [number, number, number] }> =
      waveNumber === 1
        ? [
            { personality: 'aggressor', difficulty: 1, offset: [-65, 18, -230] },
            { personality: 'flanker', difficulty: 1, offset: [85, -14, -260] },
            { personality: 'aggressor', difficulty: 2, offset: [12, 34, -310] },
          ]
        : waveNumber === 2
          ? [
              { personality: 'aggressor', difficulty: 2, offset: [-80, 22, -250] },
              { personality: 'flanker', difficulty: 2, offset: [90, -18, -240] },
              { personality: 'defender', difficulty: 2, offset: [0, 38, -320] },
            ]
          : [
              { personality: 'aggressor', difficulty: Math.min(5, waveNumber), offset: [-95, 20, -260] },
              { personality: 'flanker', difficulty: Math.min(5, waveNumber), offset: [95, -15, -260] },
              { personality: 'defender', difficulty: Math.min(5, waveNumber), offset: [-20, 44, -330] },
              { personality: 'ace', difficulty: Math.min(5, waveNumber), offset: [35, -24, -350] },
            ];

    for (let i = 0; i < roster.length && i < MAX_ENEMIES; i++) {
      const spec = roster[i];
      const pCfg = BOT_PERSONALITIES[spec.personality];
      const spawnPos = new THREE.Vector3(
        aroundPos.x + spec.offset[0],
        aroundPos.y + spec.offset[1],
        aroundPos.z + spec.offset[2],
      );
      const id = `enemy-${this.enemyIdCounter++}`;
      const callsign = CALLSIGN_POOL[(this.enemyIdCounter + i) % CALLSIGN_POOL.length];

      const enemy: EnemyEntity = {
        id,
        callsign,
        shipId: spec.personality === 'defender' ? 'destroyer' : spec.personality === 'flanker' ? 'interceptor' : 'striker',
        personality: spec.personality,
        difficulty: spec.difficulty,
        active: true,
        position: spawnPos,
        quaternion: new THREE.Quaternion(),
        velocity: new THREE.Vector3(0, 0, 20),
        visualBankAngle: 0,
        collisionRadius: ENEMY_COLLISION_RADIUS,
        health: createHealthState(pCfg.maxHull),
        aiState: 'patrol',
        aiStateTimer: 0.4 + i * 0.25,
        reactionTimer: pCfg.reactionTime,
        coordinationTimer: 4.0 + i * 0.6,
        weaponCooldown: 0.8 + i * 0.3,
        burstTimer: 1.2,
        burstActive: true,
        muzzleIndex: 0,
        patrolAnchor: spawnPos.clone(),
        patrolAngle: i * 1.9,
        flankSign: i % 2 === 0 ? 1 : -1,
        evadeDir: new THREE.Vector3(1, 0, 0),
        repositionPoint: spawnPos.clone(),
        hitFlashTimer: 0,
        muzzleFlashTimer: 0,
      };
      this.enemies.push(enemy);
    }

    this.stats.activeEnemies = this.enemies.length;
  }

  /**
   * Advances complete combat loop (weapons, projectiles, AI, collisions, waves) by `dt`.
   */
  public update(
    dt: number,
    flight: FlightController,
    input: InputSnapshot,
    telemetry: FlightTelemetry,
    camera?: THREE.PerspectiveCamera,
  ): void {
    const safeDt = Math.min(Math.max(dt, 0.0001), 0.05);
    this.simTime += safeDt;

    // Decay transient feedback timers
    if (this.playerWeaponCooldown > 0) {
      this.playerWeaponCooldown = Math.max(0, this.playerWeaponCooldown - safeDt);
    }
    if (this.hitMarkerTimer > 0) {
      this.hitMarkerTimer = Math.max(0, this.hitMarkerTimer - safeDt);
    }
    if (this.killMarkerTimer > 0) {
      this.killMarkerTimer = Math.max(0, this.killMarkerTimer - safeDt);
    }
    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer = Math.max(0, this.damageFlashTimer - safeDt);
    }
    if (this.muzzleFlashLeft > 0) {
      this.muzzleFlashLeft = Math.max(0, this.muzzleFlashLeft - safeDt);
    }
    if (this.muzzleFlashRight > 0) {
      this.muzzleFlashRight = Math.max(0, this.muzzleFlashRight - safeDt);
    }
    if (this.cameraImpulse > 0) {
      this.cameraImpulse = Math.max(0, this.cameraImpulse - safeDt * 3.8);
    }

    const playerAlive = !this.playerHealth.isDestroyed;

    // 1. Player Primary Weapon Firing (exact convergence onto 3D aiming reticle ray!)
    let isFiring = false;
    if (playerAlive && input.firePrimary) {
      isFiring = true;
      if (this.playerWeaponCooldown <= 0) {
        this.firePlayerWeapon(flight);
      }
    }

    // 2. Update Pooled Projectiles
    this.projectiles.update(safeDt);

    // 3. Update Enemy AI Pilots
    let aliveEnemies = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i];
      if (!enemy.active || enemy.health.isDestroyed) continue;
      aliveEnemies += 1;

      const aiRes = this.ai.updateEnemy(
        enemy,
        safeDt,
        this.simTime,
        flight.position,
        flight.velocity,
        playerAlive,
        this.projectiles,
        this.enemies,
      );

      if (aiRes.fired) {
        const personality = BOT_PERSONALITIES[enemy.personality];
        this.callbacks.onEnemyFire?.({
          shooterId: enemy.id,
          faction: 'enemy',
          weaponId: personality.weaponId,
          origin: aiRes.fireOrigin,
          direction: _forwardVec.set(0, 0, -1).applyQuaternion(enemy.quaternion),
          timestamp: this.simTime,
        });
      }
    }

    // 4. Swept Collision Detection (Projectiles vs Enemies & Player)
    this.resolveProjectileCollisions(flight, playerAlive);

    // 5. Ship-to-Ship Soft Collision Avoidance & Hull Scrape
    if (playerAlive) {
      this.resolveShipCollisions(flight);
    }

    // Recount surviving enemies & manage wave reinforcements
    aliveEnemies = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i].active && !this.enemies[i].health.isDestroyed) {
        aliveEnemies += 1;
      }
    }
    this.stats.activeEnemies = aliveEnemies;

    if (!this.missionMode && aliveEnemies === 0 && playerAlive) {
      this.waveRespawnTimer += safeDt;
      if (this.waveRespawnTimer >= 2.6) {
        this.waveRespawnTimer = 0;
        this.spawnWave(this.stats.wave + 1, flight.position);
      }
    } else {
      this.waveRespawnTimer = 0;
    }

    // 6. Sync Live Combat Telemetry & Screen-Space Projections (Zero Allocations)
    telemetry.hull = this.playerHealth.current;
    telemetry.maxHull = this.playerHealth.max;
    telemetry.playerDestroyed = this.playerHealth.isDestroyed;
    telemetry.isFiring = isFiring;
    telemetry.weaponName = this.playerWeapon.name;
    telemetry.weaponCooldownRatio = Math.min(
      1,
      this.playerWeaponCooldown * this.playerWeapon.fireRate,
    );
    telemetry.hitMarkerTimer = this.hitMarkerTimer;
    telemetry.killMarkerTimer = this.killMarkerTimer;
    telemetry.damageFlashTimer = this.damageFlashTimer;
    telemetry.muzzleFlashLeft = this.muzzleFlashLeft;
    telemetry.muzzleFlashRight = this.muzzleFlashRight;
    telemetry.combatStats.kills = this.stats.kills;
    telemetry.combatStats.shotsFired = this.stats.shotsFired;
    telemetry.combatStats.shotsHit = this.stats.shotsHit;
    telemetry.combatStats.damageDealt = this.stats.damageDealt;
    telemetry.combatStats.damageTaken = this.stats.damageTaken;
    telemetry.combatStats.score = this.stats.score;
    telemetry.combatStats.wave = this.stats.wave;
    telemetry.combatStats.activeEnemies = this.stats.activeEnemies;
    telemetry.activeEnemies = aliveEnemies;
    telemetry.activeProjectiles = this.projectiles.getActiveCount();

    if (camera) {
      this.projectHudTelemetry(flight, camera, telemetry);
    }
  }

  private firePlayerWeapon(flight: FlightController): void {
    const weapon = this.playerWeapon;
    const minInterval = 1 / Math.max(0.5, weapon.fireRate);
    this.playerWeaponCooldown = minInterval;

    // Alternate left & right wing cannon barrels
    const idx = this.playerMuzzleIndex % weapon.muzzleOffsets.length;
    this.playerMuzzleIndex = (this.playerMuzzleIndex + 1) % weapon.muzzleOffsets.length;
    const offset = weapon.muzzleOffsets[idx];

    if (idx === 0) this.muzzleFlashLeft = 0.065;
    else this.muzzleFlashRight = 0.065;

    // World origin of the active cannon barrel
    _muzzleLocal.set(offset[0], offset[1], offset[2]).applyQuaternion(flight.quaternion);
    _muzzleWorld.copy(flight.position).add(_muzzleLocal);

    // Compute exact 3D convergence target along the player's true aiming ray
    // If a primary target is near the reticle, converge at that target's distance so bolts cross dead-on!
    let convergeDist = weapon.convergenceDistance;
    if (this.primaryTargetId) {
      const target = this.enemies.find(
        (e) => e.id === this.primaryTargetId && e.active && !e.health.isDestroyed,
      );
      if (target) {
        const d = flight.position.distanceTo(target.position);
        if (d > 35 && d < 520) {
          convergeDist = d;
        }
      }
    }

    flight.getAimTargetPoint(_aimTarget, convergeDist);
    _fireDir.subVectors(_aimTarget, _muzzleWorld).normalize();

    // Subtle micro-spread
    if (weapon.spreadRad > 0) {
      _rightVec.set(1, 0, 0).applyQuaternion(flight.quaternion);
      _upVec.set(0, 1, 0).applyQuaternion(flight.quaternion);
      _fireDir
        .addScaledVector(_rightVec, (Math.random() - 0.5) * weapon.spreadRad)
        .addScaledVector(_upVec, (Math.random() - 0.5) * weapon.spreadRad)
        .normalize();
    }

    this.projectiles.spawn(
      PLAYER_ENTITY_ID,
      'player',
      weapon,
      _muzzleWorld,
      _fireDir,
      flight.velocity,
    );

    this.stats.shotsFired += 1;

    this.callbacks.onPlayerFire?.({
      shooterId: PLAYER_ENTITY_ID,
      faction: 'player',
      weaponId: weapon.id,
      origin: _muzzleWorld,
      direction: _fireDir,
      timestamp: this.simTime,
    });
  }

  private resolveProjectileCollisions(flight: FlightController, playerAlive: boolean): void {
    const items = this.projectiles.items;

    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (!p.active) continue;

      if (p.faction === 'player') {
        // Player projectile -> check active non-destroyed enemies (strictly never damages player!)
        for (let j = 0; j < this.enemies.length; j++) {
          const enemy = this.enemies[j];
          if (!enemy.active || enemy.health.isDestroyed) continue;
          if (p.ownerId === enemy.id) continue;

          const combinedRadius = enemy.collisionRadius + p.hitRadius;
          if (
            intersectSegmentSphere(
              p.prevPosition,
              p.position,
              enemy.position,
              combinedRadius,
              _hitPoint,
            )
          ) {
            // Deactivate projectile immediately so it can NEVER apply damage twice
            this.projectiles.release(p);

            const dmgRes = applyDamage(enemy.health, p.damage, p.ownerId, this.simTime);
            if (!dmgRes.applied) break;

            this.stats.shotsHit += 1;
            this.stats.damageDealt += dmgRes.appliedAmount;
            this.hitMarkerTimer = 0.16;

            this.callbacks.onDamage?.({
              targetId: enemy.id,
              attackerId: p.ownerId,
              weaponId: p.weaponId,
              amount: dmgRes.appliedAmount,
              remainingHealth: dmgRes.remaining,
              maxHealth: enemy.health.max,
              destroyed: dmgRes.destroyedNow,
              hitPoint: _hitPoint,
              timestamp: this.simTime,
            });

            if (dmgRes.destroyedNow) {
              enemy.active = false;
              enemy.aiState = 'destroyed';
              this.stats.kills += 1;
              this.stats.score += 100 * enemy.difficulty;
              this.killMarkerTimer = 0.34;
              this.cameraImpulse = Math.min(1, this.cameraImpulse + 0.45);

              this.callbacks.onVfxBurst?.({
                kind: 'explosion',
                position: enemy.position,
                color: '#38bdf8',
                scale: 1.35,
              });
              this.callbacks.onDestruction?.({
                entityId: enemy.id,
                callsign: enemy.callsign,
                isPriorityTarget: enemy.isPriorityTarget,
                faction: 'enemy',
                killerId: p.ownerId,
                position: enemy.position,
                timestamp: this.simTime,
              });
            } else {
              this.ai.triggerDamageReaction(enemy, flight.position, this.simTime);
              this.callbacks.onVfxBurst?.({
                kind: 'impact',
                position: _hitPoint,
                color: '#22d3ee',
                scale: 0.7,
              });
            }
            break;
          }
        }
      } else if (p.faction === 'enemy' && playerAlive) {
        // Enemy projectile -> check player ship (never damages own shooter)
        if (p.ownerId === PLAYER_ENTITY_ID) continue;

        const combinedRadius = PLAYER_COLLISION_RADIUS + p.hitRadius;
        if (
          intersectSegmentSphere(
            p.prevPosition,
            p.position,
            flight.position,
            combinedRadius,
            _hitPoint,
          )
        ) {
          this.projectiles.release(p);

          const dmgRes = applyDamage(this.playerHealth, p.damage, p.ownerId, this.simTime);
          if (!dmgRes.applied) continue;

          this.stats.damageTaken += dmgRes.appliedAmount;
          this.damageFlashTimer = 0.32;
          this.cameraImpulse = Math.min(1, this.cameraImpulse + 0.55);

          this.callbacks.onVfxBurst?.({
            kind: 'player-hit',
            position: _hitPoint,
            color: '#f97316',
            scale: 0.75,
          });
          this.callbacks.onDamage?.({
            targetId: PLAYER_ENTITY_ID,
            attackerId: p.ownerId,
            weaponId: p.weaponId,
            amount: dmgRes.appliedAmount,
            remainingHealth: dmgRes.remaining,
            maxHealth: this.playerHealth.max,
            destroyed: dmgRes.destroyedNow,
            hitPoint: _hitPoint,
            timestamp: this.simTime,
          });

          if (dmgRes.destroyedNow) {
            this.callbacks.onVfxBurst?.({
              kind: 'explosion',
              position: flight.position,
              color: '#f97316',
              scale: 1.5,
            });
            this.callbacks.onDestruction?.({
              entityId: PLAYER_ENTITY_ID,
              faction: 'player',
              killerId: p.ownerId,
              position: flight.position,
              timestamp: this.simTime,
            });
          }
        }
      }
    }
  }

  private resolveShipCollisions(flight: FlightController): void {
    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i];
      if (!enemy.active || enemy.health.isDestroyed) continue;

      if (
        intersectSphereSphere(
          flight.position,
          PLAYER_COLLISION_RADIUS,
          enemy.position,
          enemy.collisionRadius,
        )
      ) {
        _sepVec.subVectors(flight.position, enemy.position);
        const dist = _sepVec.length();
        if (dist < 0.001) _sepVec.set(0, 1, 0);
        else _sepVec.divideScalar(dist);

        const pushDist = PLAYER_COLLISION_RADIUS + enemy.collisionRadius - dist + 0.6;
        flight.position.addScaledVector(_sepVec, pushDist * 0.5);
        enemy.position.addScaledVector(_sepVec, -pushDist * 0.5);

        // Mild hull collision impact (rate-limited by lastHitTime)
        if (this.simTime - this.playerHealth.lastHitTime > 0.6) {
          const dmgRes = applyDamage(this.playerHealth, 12, enemy.id, this.simTime);
          if (dmgRes.applied) {
            this.stats.damageTaken += dmgRes.appliedAmount;
            this.damageFlashTimer = 0.35;
            this.cameraImpulse = Math.min(1, this.cameraImpulse + 0.65);
          }
          applyDamage(enemy.health, 16, PLAYER_ENTITY_ID, this.simTime);
          this.ai.triggerDamageReaction(enemy, flight.position, this.simTime);
        }
      }
    }
  }

  /**
   * Projects the true 3D weapon aiming point and all active enemy markers
   * into normalized [0..1] viewport coordinates so HUD matches 3D ballistics 1:1.
   */
  private projectHudTelemetry(
    flight: FlightController,
    camera: THREE.PerspectiveCamera,
    telemetry: FlightTelemetry,
  ): void {
    // 1. Project the true 3D cannon convergence point onto the viewport. `aimScreenX/Y`
    //    already carry this same cannon ray from FlightController's active-camera projection.
    flight.getAimTargetPoint(_aimTarget, this.playerWeapon.convergenceDistance);
    _projVec.copy(_aimTarget).project(camera);
    telemetry.boresightScreenX = THREE.MathUtils.clamp((_projVec.x + 1) * 0.5, 0.05, 0.95);
    telemetry.boresightScreenY = THREE.MathUtils.clamp((1 - _projVec.y) * 0.5, 0.06, 0.94);

    // 2. Project Active Enemy Markers & Identify Primary Target Closest to Boresight / Aim Ray
    flight.getAimDirectionWorld(_aimDir);
    let bestScore = Infinity;
    let bestIdx = -1;

    const markers = telemetry.enemyMarkers;
    for (let i = 0; i < markers.length; i++) {
      markers[i].active = false;
      markers[i].isPrimaryTarget = false;
      markers[i].leadVisible = false;
    }

    let slotIdx = 0;
    for (let i = 0; i < this.enemies.length && slotIdx < markers.length; i++) {
      const enemy = this.enemies[i];
      if (!enemy.active || enemy.health.isDestroyed) continue;

      const marker: ProjectedEnemyMarker = markers[slotIdx];
      const dist = flight.position.distanceTo(enemy.position);

      _projVec.copy(enemy.position).project(camera);
      const inFront = _projVec.z >= -1 && _projVec.z <= 1;
      let sx = (_projVec.x + 1) * 0.5;
      let sy = (1 - _projVec.y) * 0.5;

      // If behind camera, mirror onto viewport perimeter so off-screen arrow points accurately
      if (!inFront) {
        sx = 1 - sx;
        sy = 1 - sy;
      }

      const onScreen = inFront && sx >= 0.04 && sx <= 0.96 && sy >= 0.05 && sy <= 0.95;

      if (!onScreen) {
        const dx = sx - 0.5;
        const dy = sy - 0.5;
        const len = Math.hypot(dx, dy) || 1;
        const edgeScale = 0.44 / Math.max(Math.abs(dx / len), Math.abs(dy / len), 0.001);
        sx = THREE.MathUtils.clamp(0.5 + (dx / len) * Math.min(edgeScale, 0.46), 0.04, 0.96);
        sy = THREE.MathUtils.clamp(0.5 + (dy / len) * Math.min(edgeScale, 0.44), 0.06, 0.94);
      }

      marker.active = true;
      marker.entityId = enemy.id;
      marker.callsign = enemy.callsign;
      marker.personalityLabel = BOT_PERSONALITIES[enemy.personality].label;
      marker.aiState = enemy.aiState;
      marker.screenX = sx;
      marker.screenY = sy;
      marker.inFront = inFront;
      marker.onScreen = onScreen;
      marker.distance = dist;
      marker.healthRatio = getHealthRatio(enemy.health);
      marker.isPriorityTarget = Boolean(enemy.isPriorityTarget);

      // Rank best target near the player's active 3D cannon ray.
      if (inFront) {
        const aimDist = Math.hypot(sx - telemetry.boresightScreenX, sy - telemetry.boresightScreenY);
        const weightedScore = aimDist + dist * 0.00035;
        if (weightedScore < bestScore) {
          bestScore = weightedScore;
          bestIdx = slotIdx;
        }
      }

      // Compute predictive weapon lead pip for this enemy
      if (inFront && dist < 480) {
        const tHit = dist / Math.max(this.playerWeapon.projectileSpeed, 1);
        _leadWorld.copy(enemy.position).addScaledVector(enemy.velocity, tHit);
        _projVec.copy(_leadWorld).project(camera);
        if (_projVec.z >= -1 && _projVec.z <= 1) {
          marker.leadX = THREE.MathUtils.clamp((_projVec.x + 1) * 0.5, 0.04, 0.96);
          marker.leadY = THREE.MathUtils.clamp((1 - _projVec.y) * 0.5, 0.05, 0.95);
          marker.leadVisible = true;
        }
      }

      slotIdx += 1;
    }

    if (bestIdx >= 0) {
      markers[bestIdx].isPrimaryTarget = true;
      this.primaryTargetId = markers[bestIdx].entityId;
    } else {
      this.primaryTargetId = null;
    }
  }
}
