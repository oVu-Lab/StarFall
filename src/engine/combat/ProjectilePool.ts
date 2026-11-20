import * as THREE from 'three';
import type { EntityId, Faction, ProjectileState, WeaponConfig } from '../../types/combat';

export const MAX_POOLED_PROJECTILES = 160;

/**
 * Zero-allocation object-pooled 3D projectile simulator.
 * All Vector3 instances are pre-allocated at startup and recycled upon expiry or impact.
 */
export class ProjectilePool {
  public readonly items: ProjectileState[];
  private nextId = 1;
  private cursor = 0;
  private activeCount = 0;

  public constructor(capacity = MAX_POOLED_PROJECTILES) {
    this.items = new Array<ProjectileState>(capacity);
    for (let i = 0; i < capacity; i++) {
      this.items[i] = {
        id: 0,
        active: false,
        ownerId: '',
        faction: 'neutral',
        weaponId: '',
        position: new THREE.Vector3(),
        prevPosition: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        direction: new THREE.Vector3(0, 0, -1),
        damage: 0,
        age: 0,
        maxLifetime: 1,
        hitRadius: 1,
        boltLength: 4,
        boltRadius: 0.14,
        isPlayerOwned: false,
        isHomingMissile: false,
        targetId: undefined,
        launcherForward: new THREE.Vector3(0, 0, -1),
        evasionProgress: 0,
        targetLost: false,
      };
    }
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public clear(): void {
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].active = false;
    }
    this.activeCount = 0;
  }

  public spawn(
    ownerId: EntityId,
    faction: Faction,
    weapon: WeaponConfig,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    inheritedVelocity?: THREE.Vector3,
    convergencePoint?: THREE.Vector3,
  ): ProjectileState {
    const len = this.items.length;
    let slot: ProjectileState | null = null;

    // Prefer an inactive slot; if pool is saturated, recycle the oldest slot cleanly
    for (let i = 0; i < len; i++) {
      const idx = (this.cursor + i) % len;
      if (!this.items[idx].active) {
        slot = this.items[idx];
        this.cursor = (idx + 1) % len;
        break;
      }
    }

    if (!slot) {
      slot = this.items[this.cursor];
      this.cursor = (this.cursor + 1) % len;
    } else {
      this.activeCount += 1;
    }

    slot.id = this.nextId++;
    slot.active = true;
    slot.ownerId = ownerId;
    slot.faction = faction;
    slot.weaponId = weapon.id;
    slot.position.copy(origin);
    slot.prevPosition.copy(origin);
    slot.direction.copy(direction).normalize();
    slot.velocity.copy(slot.direction).multiplyScalar(weapon.projectileSpeed);
    if (inheritedVelocity) {
      // Partial velocity inheritance prevents projectiles lagging behind high-speed boosting ships
      slot.velocity.addScaledVector(inheritedVelocity, 0.3);
    }
    if (convergencePoint) {
      // Preserve the inherited forward-speed contribution while preventing lateral drift off
      // the camera-projected convergence point. No extra vector allocation is required.
      slot.direction.subVectors(convergencePoint, origin).normalize();
      const speed = Math.max(1, slot.velocity.dot(slot.direction));
      slot.velocity.copy(slot.direction).multiplyScalar(speed);
    }
    slot.damage = weapon.damage;
    slot.age = 0;
    slot.maxLifetime = weapon.lifetime;
    slot.hitRadius = weapon.hitRadius;
    slot.boltLength = weapon.boltLength;
    slot.boltRadius = weapon.boltRadius;
    slot.isPlayerOwned = faction === 'player';
    slot.isHomingMissile = false;
    slot.targetId = undefined;
    slot.evasionProgress = 0;
    slot.targetLost = false;

    return slot;
  }

  public release(proj: ProjectileState): void {
    if (!proj.active) return;
    proj.active = false;
    this.activeCount = Math.max(0, this.activeCount - 1);
  }

  public update(dt: number): void {
    const safeDt = Math.min(Math.max(dt, 0), 0.05);
    let count = 0;
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (!p.active) continue;

      p.age += safeDt;
      if (p.age >= p.maxLifetime) {
        p.active = false;
        continue;
      }

      p.prevPosition.copy(p.position);
      p.position.addScaledVector(p.velocity, safeDt);
      count += 1;
    }
    this.activeCount = count;
  }
}
