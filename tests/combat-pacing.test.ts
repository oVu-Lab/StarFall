import assert from 'node:assert/strict';
import test from 'node:test';
import { BOT_PERSONALITIES, resolveBotDifficultyTuning } from '../src/config/botPersonalities.ts';
import { DIFFICULTY_PROFILES } from '../src/config/difficulty.ts';
import { SHIP_CONFIGS } from '../src/config/ships.ts';

test('player flight profiles use the phase-one pacing targets and retain class differences', () => {
  assert.deepEqual(
    Object.values(SHIP_CONFIGS).map(({ id, flight }) => [id, flight.maxSpeed, flight.acceleration]),
    [
      ['interceptor', 105, 70],
      ['striker', 98, 63],
      ['destroyer', 84, 53],
    ],
  );
  assert.deepEqual(
    Object.values(SHIP_CONFIGS).map(({ flight }) => [flight.boostMultiplier, flight.boostAccelMultiplier]),
    [
      [1.85, 2.35],
      [1.72, 2.1],
      [1.62, 1.9],
    ],
    'phase one leaves boost tuning unchanged',
  );
});

test('enemy base movement profiles create slower cruise and bounded boost speeds', () => {
  const profiles = Object.values(BOT_PERSONALITIES);
  assert.deepEqual(profiles.map(({ cruiseSpeed }) => cruiseSpeed), [60, 65, 52, 70]);
  assert.deepEqual(profiles.map(({ boostSpeed }) => boostSpeed), [88, 94, 76, 100]);
  assert.ok(profiles.every(({ boostSpeed, cruiseSpeed }) => boostSpeed > cruiseSpeed));
});

test('difficulty speed scaling remains active for enemy profiles', () => {
  const ace = BOT_PERSONALITIES.ace;
  assert.equal(resolveBotDifficultyTuning(ace, 'rookie').cruiseSpeed, ace.cruiseSpeed * DIFFICULTY_PROFILES.rookie.speedScale);
  assert.equal(resolveBotDifficultyTuning(ace, 'elite').boostSpeed, ace.boostSpeed * DIFFICULTY_PROFILES.elite.speedScale);
});
