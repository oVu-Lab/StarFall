import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT_PERSONALITIES } from '../src/config/botPersonalities';
import { SHIP_CONFIGS } from '../src/config/ships';
import { applyShieldedDamage, createHealthState, createShieldState, updateShieldRecharge } from '../src/engine/combat/HealthSystem';

test('shield absorbs damage before hull', () => {
  const health = createHealthState(100);
  const shield = createShieldState(50);
  const result = applyShieldedDamage(shield, health, 30, 'attacker', 1);
  assert.equal(result.shieldDamage, 30);
  assert.equal(result.hullDamage, 0);
  assert.equal(shield.current, 20);
  assert.equal(health.current, 100);
});

test('overflow damage reaches hull and zero hull destroys the ship', () => {
  const health = createHealthState(20);
  const shield = createShieldState(10);
  const result = applyShieldedDamage(shield, health, 35, 'attacker', 1);
  assert.equal(result.shieldDamage, 10);
  assert.equal(result.hullDamage, 20);
  assert.equal(health.current, 0);
  assert.equal(health.isDestroyed, true);
  assert.equal(result.destroyedNow, true);
});

test('shield recharge waits for its configured delay', () => {
  const shield = createShieldState(50, 3, 10);
  applyShieldedDamage(shield, createHealthState(100), 20, 'attacker', 2);
  assert.deepEqual(updateShieldRecharge(shield, 1, 4.99), { began: false, amount: 0 });
  assert.equal(shield.current, 30);
  assert.equal(shield.isRecharging, false);
});

test('shield regeneration uses the configured rate smoothly', () => {
  const shield = createShieldState(50, 2, 10);
  applyShieldedDamage(shield, createHealthState(100), 20, 'attacker', 0);
  const first = updateShieldRecharge(shield, 0.25, 2);
  assert.equal(first.began, true);
  assert.equal(first.amount, 2.5);
  assert.equal(shield.current, 32.5);
  assert.equal(updateShieldRecharge(shield, 0.5, 2.5).began, false);
  assert.equal(shield.current, 37.5);
});

test('damage resets recharge timing and stops an active recharge', () => {
  const health = createHealthState(100);
  const shield = createShieldState(50, 2, 10);
  applyShieldedDamage(shield, health, 20, 'attacker', 0);
  updateShieldRecharge(shield, 0.5, 2);
  assert.equal(shield.isRecharging, true);
  applyShieldedDamage(shield, health, 5, 'attacker', 2.4);
  assert.equal(shield.isRecharging, false);
  assert.deepEqual(updateShieldRecharge(shield, 0.5, 4.39), { began: false, amount: 0 });
  assert.equal(updateShieldRecharge(shield, 0.1, 4.4).began, true);
});

test('shield break transition fires once until the shield recovers', () => {
  const health = createHealthState(100);
  const shield = createShieldState(10, 1, 10);
  assert.equal(applyShieldedDamage(shield, health, 20, 'attacker', 0).shieldBrokenNow, true);
  assert.equal(applyShieldedDamage(shield, health, 4, 'attacker', 0.2).shieldBrokenNow, false);
  assert.equal(shield.isBroken, true);
  updateShieldRecharge(shield, 0.1, 1.2);
  assert.equal(shield.isBroken, false);
  assert.equal(applyShieldedDamage(shield, health, 30, 'attacker', 1.3).shieldBrokenNow, true);
});

test('enemy shields route cannon and missile-sized hits through shield then hull', () => {
  const config = BOT_PERSONALITIES.aggressor;
  const health = createHealthState(config.maxHull);
  const shield = createShieldState(config.maxShield, config.shieldRechargeDelay, config.shieldRechargeRate);
  const cannon = applyShieldedDamage(shield, health, 18, 'player', 0);
  assert.equal(cannon.shieldDamage, 18);
  assert.equal(cannon.hullDamage, 0);
  const missile = applyShieldedDamage(shield, health, 34, 'player', 0.5);
  assert.equal(missile.shieldDamage, 20);
  assert.equal(missile.hullDamage, 14);
  assert.equal(health.current, config.maxHull - 14);
});

test('player ship classes have explicit shield tuning and hull values remain unchanged', () => {
  assert.deepEqual(
    Object.values(SHIP_CONFIGS).map(({ maxHull, maxShield, shieldRechargeDelay, shieldRechargeRate }) => ({ maxHull, maxShield, shieldRechargeDelay, shieldRechargeRate })),
    [
      { maxHull: 100, maxShield: 75, shieldRechargeDelay: 4, shieldRechargeRate: 8 },
      { maxHull: 150, maxShield: 110, shieldRechargeDelay: 4, shieldRechargeRate: 9 },
      { maxHull: 230, maxShield: 160, shieldRechargeDelay: 4.5, shieldRechargeRate: 10 },
    ],
  );
});
