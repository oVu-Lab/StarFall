import * as THREE from 'three';
import { BOT_PERSONALITIES, resolveBotDifficultyTuning } from '../../config/botPersonalities';
import { WEAPON_CONFIGS } from '../../config/weapons';
import type { EnemyEntity } from '../../types/combat';
import type { ProjectilePool } from './ProjectilePool';

// Reusable scratch vectors & quaternions (zero GC in frame loop)
const _toPlayer = new THREE.Vector3();
const _desiredPos = new THREE.Vector3();
const _desiredDir = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _lookMat = new THREE.Matrix4();
const _targetQuat = new THREE.Quaternion();
const _origin = new THREE.Vector3();
const _muzzleLocal = new THREE.Vector3();
const _leadPoint = new THREE.Vector3();
const _fireDir = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _localDir = new THREE.Vector3();
const _invQuat = new THREE.Quaternion();
const _zeroVec = new THREE.Vector3(0, 0, 0);
const _relativeFromTarget = new THREE.Vector3();
const _targetForward = new THREE.Vector3();
const _targetRight = new THREE.Vector3();

export const MAX_SIMULTANEOUS_ATTACK_RUNS = 2;
export const ATTACK_RUN_DURATION_SEC: Record<EnemyEntity['personality'], number> = {
  aggressor: 5.0,
  flanker: 4.5,
  defender: 5.8,
  ace: 4.2,
};
const ATTACK_PASS_REAR_DISTANCE = 70;

export type AttackRunEndReason = 'danger-close' | 'passed-target' | 'lost-range' | 'timeout';

export function getAttackRunEndReason(
  distance: number,
  minSafeDistance: number,
  forwardBearing: number,
  engageRange: number,
  remainingTime: number,
): AttackRunEndReason | null {
  if (distance <= minSafeDistance) return 'danger-close';
  if (forwardBearing < -ATTACK_PASS_REAR_DISTANCE) return 'passed-target';
  if (distance > engageRange * 1.45) return 'lost-range';
  if (remainingTime <= 0) return 'timeout';
  return null;
}

function countActiveAttackRuns(enemies: EnemyEntity[]): number {
  let count = 0;
  for (const other of enemies) {
    if (other.active && !other.health.isDestroyed && other.aiState === 'engage') count += 1;
  }
  return count;
}

export interface EnemyAIUpdateResult {
  fired: boolean;
  fireOrigin: THREE.Vector3;
}

const _resultOrigin = new THREE.Vector3();

/**
 * State-based Enemy Combat Pilot AI.
 * Drives enemy starfighters through smooth quaternion turning and velocity propulsion
 * (never snaps or teleports) across 7 tactical states:
 * patrol -> acquire -> pursue -> engage -> evade -> reposition -> destroyed.
 */
export class EnemyAIController {
  public triggerDamageReaction(
    enemy: EnemyEntity,
    playerPos: THREE.Vector3,
    now: number,
  ): void {
    if (!enemy.active || enemy.health.isDestroyed) return;
    enemy.hitFlashTimer = 0.14;

    const personality = BOT_PERSONALITIES[enemy.personality];
    const tuning = resolveBotDifficultyTuning(
      personality,
      enemy.difficultyLevel ?? enemy.difficulty,
    );

    // Already evading or repositioning — only flip flank sign occasionally
    if (enemy.aiState === 'evade') return;

    // Deterministic-feeling probabilistic jink based on personality responsiveness
    const roll = Math.abs(Math.sin(now * 37.3 + enemy.position.x * 0.13));
    if (roll <= tuning.evadeResponsiveness) {
      enemy.aiState = 'evade';
      enemy.aiStateTimer = personality.evadeDuration;
      enemy.flankSign = enemy.flankSign === 1 ? -1 : 1;

      // Compute perpendicular jink vector away from player's line of fire
      _toPlayer.subVectors(playerPos, enemy.position).normalize();
      _perp.crossVectors(_toPlayer, _up);
      if (_perp.lengthSq() < 0.01) {
        _perp.set(1, 0, 0);
      } else {
        _perp.normalize();
      }
      const verticalLift = (roll - 0.35) * 0.75;
      enemy.evadeDir
        .copy(_perp)
        .multiplyScalar(enemy.flankSign)
        .addScaledVector(_up, verticalLift)
        .addScaledVector(_toPlayer, -0.35)
        .normalize();
    } else if (enemy.aiState === 'patrol') {
      // Immediately alert if attacked while patrolling
      enemy.aiState = 'acquire';
      enemy.aiStateTimer = tuning.reactionTime;
    }
  }

  public updateEnemy(
    enemy: EnemyEntity,
    dt: number,
    now: number,
    targetPos: THREE.Vector3,
    targetVel: THREE.Vector3,
    targetAlive: boolean,
    projectiles: ProjectilePool,
    allEnemies: EnemyEntity[],
    targetForward?: THREE.Vector3,
  ): EnemyAIUpdateResult {
    const safeDt = Math.min(Math.max(dt, 0.0001), 0.05);
    const out: EnemyAIUpdateResult = { fired: false, fireOrigin: _resultOrigin };

    if (!enemy.active || enemy.health.isDestroyed) {
      enemy.aiState = 'destroyed';
      return out;
    }

    if (enemy.hitFlashTimer > 0) {
      enemy.hitFlashTimer = Math.max(0, enemy.hitFlashTimer - safeDt);
    }
    if (enemy.muzzleFlashTimer > 0) {
      enemy.muzzleFlashTimer = Math.max(0, enemy.muzzleFlashTimer - safeDt);
    }
    if (enemy.weaponCooldown > 0) {
      enemy.weaponCooldown = Math.max(0, enemy.weaponCooldown - safeDt);
    }

    const personality = BOT_PERSONALITIES[enemy.personality];
    const tuning = resolveBotDifficultyTuning(
      personality,
      enemy.difficultyLevel ?? enemy.difficulty,
    );
    const weapon = WEAPON_CONFIGS[personality.weaponId] ?? WEAPON_CONFIGS.enemy_pulse_aggressor;

    _toPlayer.subVectors(targetPos, enemy.position);
    const distToPlayer = _toPlayer.length();
    const dirToPlayer = distToPlayer > 0.001 ? _toPlayer.divideScalar(distToPlayer) : _forward.set(0, 0, -1);
    if (targetForward && targetForward.lengthSq() > 0.01) {
      _targetForward.copy(targetForward).normalize();
    } else if (targetVel.lengthSq() > 16) {
      _targetForward.copy(targetVel).normalize();
    } else {
      // With a stationary protected actor, treat the target's current bearing as its approach axis.
      _targetForward.copy(dirToPlayer).negate();
    }
    _relativeFromTarget.subVectors(enemy.position, targetPos);
    const isInFrontAttackArea = _relativeFromTarget.dot(_targetForward) >= -12;
    _targetRight.crossVectors(_targetForward, _up);
    if (_targetRight.lengthSq() < 0.01) _targetRight.set(1, 0, 0);
    else _targetRight.normalize();

    enemy.aiStateTimer = Math.max(0, enemy.aiStateTimer - safeDt);
    enemy.coordinationTimer = Math.max(0, enemy.coordinationTimer - safeDt);
    const attackRunSlotAvailable = countActiveAttackRuns(allEnemies) < MAX_SIMULTANEOUS_ATTACK_RUNS;

    // Coordinated squad flank-vector shift governed by DifficultyProfile
    if (enemy.coordinationTimer <= 0 && enemy.aiState === 'pursue' && isInFrontAttackArea) {
      enemy.coordinationTimer = tuning.coordinationIntervalSec;
      if (personality.flankAngleRad >= 0.45) {
        enemy.flankSign = enemy.flankSign === 1 ? -1 : 1;
      }
    }

    // 1. State Machine Transitions
    if (!targetAlive) {
      enemy.aiState = 'patrol';
    } else {
      switch (enemy.aiState) {
        case 'patrol': {
          if (distToPlayer <= personality.detectionRange) {
            enemy.aiState = 'acquire';
            enemy.aiStateTimer = tuning.reactionTime;
          }
          break;
        }
        case 'acquire': {
          if (enemy.aiStateTimer <= 0) {
            const canEngage = distToPlayer <= personality.engageRange && isInFrontAttackArea && attackRunSlotAvailable;
            enemy.aiState = canEngage ? 'engage' : 'pursue';
            enemy.aiStateTimer = canEngage ? ATTACK_RUN_DURATION_SEC[personality.id] : 2.4;
          }
          break;
        }
        case 'pursue': {
          if (distToPlayer <= personality.minSafeDistance) {
            this.beginReposition(enemy, targetPos, personality.preferredRange, _targetForward);
          } else if (distToPlayer <= personality.engageRange && isInFrontAttackArea && attackRunSlotAvailable) {
            enemy.aiState = 'engage';
            enemy.aiStateTimer = ATTACK_RUN_DURATION_SEC[personality.id];
          }
          break;
        }
        case 'engage': {
          const runEndReason = getAttackRunEndReason(
            distToPlayer,
            personality.minSafeDistance,
            _relativeFromTarget.dot(_targetForward),
            personality.engageRange,
            enemy.aiStateTimer,
          );
          if (runEndReason) {
            // End only for a close pass, leaving the engagement envelope, or using the full run window.
            this.beginReposition(enemy, targetPos, personality.preferredRange, _targetForward);
          }
          break;
        }
        case 'evade': {
          if (enemy.aiStateTimer <= 0) {
            if (distToPlayer < personality.minSafeDistance * 1.2) {
              this.beginReposition(enemy, targetPos, personality.preferredRange, _targetForward);
            } else {
              enemy.aiState = 'pursue';
              enemy.aiStateTimer = 2.0;
            }
          }
          break;
        }
        case 'reposition': {
          // Player heading can change while the enemy is breaking away. Keep the approach
          // destination in the target's current world-space forward lane, not a stale snapshot.
          this.setRepositionPoint(enemy, targetPos, personality.preferredRange, _targetForward);
          const distToAnchor = enemy.position.distanceTo(enemy.repositionPoint);
          if (distToAnchor < 38 || enemy.aiStateTimer <= 0) {
            enemy.aiState = 'pursue';
            enemy.aiStateTimer = 2.4;
          }
          break;
        }
        case 'destroyed':
          return out;
      }
    }

    const attackRunCapacityAvailable = countActiveAttackRuns(allEnemies) < MAX_SIMULTANEOUS_ATTACK_RUNS;

    // 2. Compute Desired Flight Vector & Speed Based on Current AI State + Personality
    let targetSpeed = tuning.cruiseSpeed;

    if (enemy.aiState === 'patrol') {
      enemy.patrolAngle += safeDt * 0.28;
      _desiredPos.set(
        enemy.patrolAnchor.x + Math.cos(enemy.patrolAngle) * 110,
        enemy.patrolAnchor.y + Math.sin(enemy.patrolAngle * 1.3) * 24,
        enemy.patrolAnchor.z + Math.sin(enemy.patrolAngle) * 110,
      );
      _desiredDir.subVectors(_desiredPos, enemy.position).normalize();
      targetSpeed = tuning.cruiseSpeed * 0.72;
    } else if (enemy.aiState === 'acquire') {
      _desiredDir.copy(dirToPlayer);
      targetSpeed = tuning.cruiseSpeed * 0.85;
    } else if (enemy.aiState === 'pursue') {
      // Rear-hemisphere enemies rendezvous at a forward-side waypoint instead of tracking the
      // player's tail. Flankers keep a larger, fixed lateral offset on the way in.
      if (!isInFrontAttackArea) {
        const lateralScale = personality.id === 'flanker' ? 0.62 : personality.id === 'ace' ? 0.38 : personality.id === 'defender' ? 0.18 : 0.06;
        _desiredPos.copy(targetPos)
          .addScaledVector(_targetForward, personality.preferredRange * 0.72)
          .addScaledVector(_targetRight, enemy.flankSign * personality.preferredRange * lateralScale);
        _desiredDir.subVectors(_desiredPos, enemy.position).normalize();
      } else {
        if (!attackRunCapacityAvailable && distToPlayer <= personality.engageRange * 1.15) {
          // Queue at a personality-specific forward-side staging point while another pair runs in.
          const lateralScale = personality.id === 'aggressor' ? 0.12 : personality.id === 'flanker' ? 0.52 : personality.id === 'defender' ? 0.18 : 0.34;
          _desiredPos.copy(targetPos)
            .addScaledVector(_targetForward, personality.preferredRange * 1.08)
            .addScaledVector(_targetRight, enemy.flankSign * personality.preferredRange * lateralScale);
          _desiredDir.subVectors(_desiredPos, enemy.position).normalize();
          targetSpeed = tuning.cruiseSpeed * 0.65;
        } else {
          _desiredDir.copy(dirToPlayer);
          if (personality.id === 'flanker') {
            _desiredDir.addScaledVector(_targetRight, enemy.flankSign * 0.24).normalize();
          } else if (personality.id === 'ace') {
            _desiredDir.addScaledVector(_targetRight, enemy.flankSign * 0.12).normalize();
          }
        }
      }
      if (attackRunCapacityAvailable || distToPlayer > personality.engageRange * 1.15) {
        targetSpeed = distToPlayer > personality.engageRange * 1.15 ? tuning.boostSpeed : tuning.cruiseSpeed;
      }
    } else if (enemy.aiState === 'engage') {
      // Commit to a short forward attack run; the state timer and rear-bearing check end it.
      const timeToHit = THREE.MathUtils.clamp(distToPlayer / Math.max(weapon.projectileSpeed, 1), 0, 1.4);
      _leadPoint.copy(targetPos).addScaledVector(targetVel, timeToHit * 0.72);
      _desiredDir.subVectors(_leadPoint, enemy.position).normalize();

      if (personality.id === 'flanker') {
        _desiredDir.addScaledVector(_targetRight, enemy.flankSign * 0.18).normalize();
      } else if (personality.id === 'ace') {
        _desiredDir.addScaledVector(_targetRight, enemy.flankSign * 0.1).normalize();
      } else if (personality.id === 'defender') {
        const rangeError = distToPlayer - personality.preferredRange;
        if (Math.abs(rangeError) <= 24) {
          // Small tangent component preserves a stable standoff while keeping the guns near target.
          _perp.crossVectors(dirToPlayer, _up).normalize();
          _desiredDir.copy(dirToPlayer).addScaledVector(_perp, enemy.flankSign * 0.12).normalize();
        } else if (rangeError < -24) {
          _desiredDir.copy(dirToPlayer).negate();
        }
      }

      targetSpeed =
        distToPlayer > personality.preferredRange
          ? tuning.cruiseSpeed * 0.85
          : tuning.cruiseSpeed * (personality.id === 'defender' ? 0.25 : 0.35);
    } else if (enemy.aiState === 'evade') {
      _desiredDir.copy(enemy.evadeDir);
      targetSpeed = tuning.boostSpeed;
    } else if (enemy.aiState === 'reposition') {
      _desiredDir.subVectors(enemy.repositionPoint, enemy.position).normalize();
      targetSpeed = tuning.boostSpeed * 0.96;
    }

    // 3. Soft wingman separation so enemy bots don't stack on top of each other
    for (let i = 0; i < allEnemies.length; i++) {
      const other = allEnemies[i];
      if (!other.active || other.id === enemy.id || other.health.isDestroyed) continue;
      const dx = enemy.position.x - other.position.x;
      const dy = enemy.position.y - other.position.y;
      const dz = enemy.position.z - other.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > 0.01 && distSq < 900) {
        const invDist = 1 / Math.sqrt(distSq);
        const push = (30 - 1 / invDist) / 30;
        _desiredDir.x += dx * invDist * push * 0.75;
        _desiredDir.y += dy * invDist * push * 0.75;
        _desiredDir.z += dz * invDist * push * 0.75;
      }
    }
    if (_desiredDir.lengthSq() > 0.0001) {
      _desiredDir.normalize();
    }

    // 4. Smooth Quaternion Turn Physics (strictly angular-rate-limited, never snaps!)
    _lookMat.lookAt(_zeroVec, _desiredDir, _up);
    _targetQuat.setFromRotationMatrix(_lookMat);

    const maxStepAngle = tuning.turnRate * safeDt;
    const angleDiff = enemy.quaternion.angleTo(_targetQuat);
    if (angleDiff > 0.0001) {
      const t = Math.min(1, maxStepAngle / angleDiff);
      enemy.quaternion.slerp(_targetQuat, t);
      enemy.quaternion.normalize();
    }

    // Compute natural visual bank angle based on local lateral turn direction
    _invQuat.copy(enemy.quaternion).invert();
    _localDir.copy(_desiredDir).applyQuaternion(_invQuat);
    const desiredBank = THREE.MathUtils.clamp(-_localDir.x * 1.1, -0.65, 0.65);
    enemy.visualBankAngle = THREE.MathUtils.damp(enemy.visualBankAngle, desiredBank, 5.5, safeDt);

    // 5. Momentum-based forward propulsion along ship facing (-Z)
    _forward.set(0, 0, -1).applyQuaternion(enemy.quaternion).normalize();
    const desiredVelX = _forward.x * targetSpeed;
    const desiredVelY = _forward.y * targetSpeed;
    const desiredVelZ = _forward.z * targetSpeed;
    const velAlpha = 1 - Math.exp(-3.4 * safeDt);
    enemy.velocity.x = THREE.MathUtils.lerp(enemy.velocity.x, desiredVelX, velAlpha);
    enemy.velocity.y = THREE.MathUtils.lerp(enemy.velocity.y, desiredVelY, velAlpha);
    enemy.velocity.z = THREE.MathUtils.lerp(enemy.velocity.z, desiredVelZ, velAlpha);

    enemy.position.addScaledVector(enemy.velocity, safeDt);

    // 6. Tactical Burst Weapon Firing (only when aligned & inside engage envelope)
    if (
      targetAlive &&
      (enemy.aiState === 'engage' ||
        (enemy.aiState === 'pursue' && attackRunCapacityAvailable && isInFrontAttackArea && distToPlayer < personality.engageRange * 1.05))
    ) {
      const timeToTarget = THREE.MathUtils.clamp(distToPlayer / Math.max(weapon.projectileSpeed, 1), 0, 1.3);
      _leadPoint.copy(targetPos).addScaledVector(targetVel, timeToTarget * 0.78);
      _fireDir.subVectors(_leadPoint, enemy.position).normalize();

      const alignment = _forward.dot(_fireDir);
      const fireConeCos = Math.cos(THREE.MathUtils.degToRad(18));

      // Manage burst cadence scaled by DifficultyProfile burstPressureScale
      enemy.burstTimer -= safeDt;
      if (enemy.burstTimer <= 0) {
        enemy.burstActive = !enemy.burstActive;
        enemy.burstTimer = enemy.burstActive
          ? 1.05 * tuning.burstPressureScale
          : Math.max(0.55, 1.15 / Math.max(0.5, tuning.burstPressureScale));
      }

      if (enemy.burstActive && alignment >= fireConeCos && enemy.weaponCooldown <= 0) {
        // Apply personality + difficulty angular dispersion
        const spread = tuning.aimSpreadRad + weapon.spreadRad;
        _right.set(1, 0, 0).applyQuaternion(enemy.quaternion);
        const jitterX = (Math.random() - 0.5) * 2 * spread;
        const jitterY = (Math.random() - 0.5) * 2 * spread;
        _fireDir
          .addScaledVector(_right, jitterX)
          .addScaledVector(_up, jitterY)
          .normalize();

        const muzzle = weapon.muzzleOffsets[enemy.muzzleIndex % weapon.muzzleOffsets.length];
        enemy.muzzleIndex = (enemy.muzzleIndex + 1) % weapon.muzzleOffsets.length;
        _muzzleLocal.set(muzzle[0], muzzle[1], muzzle[2]).applyQuaternion(enemy.quaternion);
        _origin.copy(enemy.position).add(_muzzleLocal);

        projectiles.spawn(enemy.id, 'enemy', weapon, _origin, _fireDir, enemy.velocity);
        enemy.weaponCooldown = 1 / Math.max(0.5, weapon.fireRate * tuning.fireCadenceScale);
        enemy.muzzleFlashTimer = 0.06;

        out.fired = true;
        out.fireOrigin.copy(_origin);
      }
    }

    return out;
  }

  private beginReposition(
    enemy: EnemyEntity,
    playerPos: THREE.Vector3,
    preferredRange: number,
    targetForward: THREE.Vector3,
  ): void {
    enemy.aiState = 'reposition';
    enemy.aiStateTimer = 4.0;
    enemy.flankSign = enemy.flankSign === 1 ? -1 : 1;

    _targetRight.crossVectors(targetForward, _up);
    if (_targetRight.lengthSq() < 0.01) _targetRight.set(1, 0, 0);
    else _targetRight.normalize();

    this.setRepositionPoint(enemy, playerPos, preferredRange, targetForward);
  }

  private setRepositionPoint(
    enemy: EnemyEntity,
    targetPos: THREE.Vector3,
    preferredRange: number,
    targetForward: THREE.Vector3,
  ): void {
    _targetRight.crossVectors(targetForward, _up);
    if (_targetRight.lengthSq() < 0.01) _targetRight.set(1, 0, 0);
    else _targetRight.normalize();

    enemy.repositionPoint
      .copy(targetPos)
      .addScaledVector(targetForward, preferredRange * 0.72)
      .addScaledVector(_targetRight, enemy.flankSign * preferredRange * (enemy.personality === 'flanker' ? 0.68 : 0.4))
      .addScaledVector(_up, enemy.flankSign * 26);
  }
}
