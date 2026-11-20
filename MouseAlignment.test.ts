/**
 * Mathematical simulation of the mouse-to-reticle alignment loop (NOT a browser test).
 *
 * The harness reproduces FlightController's per-frame glue with the real config constants:
 * world-anchored target, error -> demand, first-order rate smoothing, local-space yaw/pitch
 * quaternion integration, forward flight, and a chase camera that lags the hull (so the
 * old "camera cancels hull rotation" failure mode is part of the simulated world).
 *
 * Run: npx tsx --test MouseAlignment.test.ts
 * This is Claude's separate world-direction design, not the active screen-fixed runtime model.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BASE_CAMERA_FOV_DEG,
  computeAlignmentError,
  createAlignmentError,
  createScreenOffset,
  evaluateAlignmentResponse,
  focalLengthPx,
  projectDirectionToScreenOffset,
  rotateByQuat,
  rotateByQuatInverse,
  rotateTargetByMouse,
  type AlignmentResponseConfig,
  type QuatLike,
  type Vec3Like,
} from './MouseAlignment';

// ---- independent simulation tuning ----------------------------------------------------------
const RESPONSE: AlignmentResponseConfig = {
  referenceFraction: 0.26,
  errorDeadzonePx: 0.5,
  linearGain: 1.0,
  quadGain: 0.9,
};
const TAU = 0.045;
const MAX_YAW = 2.6;
const MAX_PITCH = 2.25 * 0.9;
const VW = 1280;
const VH = 720;
const PROJ_DIST = 240;
const BOUNDARY_HALF_W = VW * 0.3 * 0.5; // 192 px
const F = focalLengthPx(VH, BASE_CAMERA_FOV_DEG);

// ---- tiny quaternion helpers -------------------------------------------------------------------
function qMul(a: QuatLike, b: QuatLike): QuatLike {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
function qAxis(ax: number, ay: number, az: number, ang: number): QuatLike {
  const s = Math.sin(ang / 2);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(ang / 2) };
}
function qNorm(q: QuatLike): QuatLike {
  const l = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}
function qSlerp(a: QuatLike, b: QuatLike, t: number): QuatLike {
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  let dot = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (dot < 0) { dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (dot > 0.9995) {
    return qNorm({ x: a.x + (bx - a.x) * t, y: a.y + (by - a.y) * t, z: a.z + (bz - a.z) * t, w: a.w + (bw - a.w) * t });
  }
  const th = Math.acos(dot);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return { x: a.x * wa + bx * wb, y: a.y * wa + by * wb, z: a.z * wa + bz * wb, w: a.w * wa + bw * wb };
}
function angleBetween(a: Vec3Like, b: Vec3Like): number {
  const d = a.x * b.x + a.y * b.y + a.z * b.z;
  const c = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  return Math.atan2(Math.hypot(c.x, c.y, c.z), d);
}

// ---- simulation --------------------------------------------------------------------------------
class Sim {
  pos: Vec3Like = { x: 0, y: 12, z: 40 };
  q: QuatLike = { x: 0, y: 0, z: 0, w: 1 };
  yawRate = 0;
  pitchRate = 0;
  aimLocal: Vec3Like = { x: 0, y: 0, z: -1 };
  target: Vec3Like = { x: 0, y: 0, z: -1 };
  camQ: QuatLike = { x: 0, y: 0, z: 0, w: 1 };
  camPos: Vec3Like = { x: 0, y: 0, z: 0 };
  speed = 135;
  time = 0;
  readonly err = createAlignmentError();
  lastYawRate = 0;
  maxRateJump = 0;

  constructor(initialQ?: QuatLike) {
    if (initialQ) this.q = initialQ;
    this.aimLocal = { x: 0, y: 0, z: -1 };
    rotateByQuat(this.aimLocal, this.q, this.target);
    this.updateCamera(1 / 60, true);
  }

  forward(): Vec3Like {
    return rotateByQuat({ x: 0, y: 0, z: -1 }, this.q, { x: 0, y: 0, z: 0 });
  }

  private updateCamera(dt: number, snap = false): void {
    // Chase camera: follows hull orientation with exponential lag (lambda ~ CameraController's 20-26/s)
    const desired = qNorm(qMul(this.q, qAxis(1, 0, 0, -0.033))); // looks ~1.9 deg down at the ship's nose
    const lambda = 20 + Math.hypot(this.yawRate, this.pitchRate) * 2.2;
    this.camQ = snap ? desired : qSlerp(this.camQ, desired, 1 - Math.exp(-lambda * dt));
    const off = rotateByQuat({ x: 0, y: 2.25, z: 9.8 }, this.camQ, { x: 0, y: 0, z: 0 });
    this.camPos = { x: this.pos.x + off.x, y: this.pos.y + off.y, z: this.pos.z + off.z };
  }

  /** One frame in GameScene order: flight.update -> camera chase -> sync projection. */
  step(dt: number, mouseDxPx = 0, mouseDyPx = 0, rollRate = 0): void {
    if (mouseDxPx !== 0 || mouseDyPx !== 0) {
      rotateTargetByMouse(this.target, this.q, mouseDxPx / F, mouseDyPx / F);
    }
    const tLocal = rotateByQuatInverse(this.target, this.q, { x: 0, y: 0, z: 0 });
    computeAlignmentError(this.aimLocal, tLocal, this.err);
    const resp = evaluateAlignmentResponse(this.err.angle, F, VH, RESPONSE);
    const tYaw = this.err.axisY * resp.demand * MAX_YAW;
    const tPitch = this.err.axisX * resp.demand * MAX_PITCH;
    const a = 1 - Math.exp(-dt / TAU);
    this.yawRate += (tYaw - this.yawRate) * a;
    this.pitchRate += (tPitch - this.pitchRate) * a;
    // Do not coast through the requested orientation after a fast approach.
    const cap = this.err.angle / dt;
    const rate = Math.hypot(this.yawRate, this.pitchRate);
    if (rate > cap && rate > 0) {
      this.yawRate *= cap / rate;
      this.pitchRate *= cap / rate;
    }
    this.maxRateJump = Math.max(this.maxRateJump, Math.abs(this.yawRate - this.lastYawRate));
    this.lastYawRate = this.yawRate;

    let q = qMul(this.q, qAxis(0, 1, 0, this.yawRate * dt));
    q = qMul(q, qAxis(1, 0, 0, this.pitchRate * dt));
    if (rollRate) q = qMul(q, qAxis(0, 0, 1, rollRate * dt));
    this.q = qNorm(q);

    const fwd = this.forward();
    this.pos = { x: this.pos.x + fwd.x * this.speed * dt, y: this.pos.y + fwd.y * this.speed * dt, z: this.pos.z + fwd.z * this.speed * dt };
    this.updateCamera(dt);
    this.time += dt;
  }

  run(seconds: number, dt = 1 / 60): void {
    for (let i = 0; i < Math.round(seconds / dt); i++) this.step(dt);
  }

  aimWorld(): Vec3Like {
    return rotateByQuat(this.aimLocal, this.q, { x: 0, y: 0, z: 0 });
  }
  errorAngle(): number {
    const tLocal = rotateByQuatInverse(this.target, this.q, { x: 0, y: 0, z: 0 });
    return computeAlignmentError(this.aimLocal, tLocal).angle;
  }
  screenR() {
    return projectDirectionToScreenOffset(this.pos, this.aimWorld(), PROJ_DIST, this.camPos, this.camQ, BASE_CAMERA_FOV_DEG, VH, createScreenOffset());
  }
  screenV() {
    return projectDirectionToScreenOffset(this.pos, this.target, PROJ_DIST, this.camPos, this.camQ, BASE_CAMERA_FOV_DEG, VH, createScreenOffset());
  }
}

const DT = 1 / 60;

/** Moves the mouse for `frames` frames (total px split evenly), then lets the mouse rest. */
function flick(sim: Sim, totalDx: number, totalDy: number, frames = 6): void {
  for (let i = 0; i < frames; i++) sim.step(DT, totalDx / frames, totalDy / frames);
}

// ---- tests ---------------------------------------------------------------------------------------
describe('math primitives', () => {
  it('quaternion rotate / inverse round-trips', () => {
    const q = qNorm({ x: 0.3, y: -0.5, z: 0.2, w: 0.7 });
    const v = { x: 1.2, y: -3, z: 0.4 };
    const r = rotateByQuatInverse(rotateByQuat(v, q, { x: 0, y: 0, z: 0 }), q, { x: 0, y: 0, z: 0 });
    assert.ok(Math.abs(r.x - v.x) + Math.abs(r.y - v.y) + Math.abs(r.z - v.z) < 1e-12);
  });

  it('error axis sign convention: target left => +yaw, target up => +pitch', () => {
    const aim = { x: 0, y: 0, z: -1 };
    const left = computeAlignmentError(aim, { x: -Math.sin(0.2), y: 0, z: -Math.cos(0.2) });
    assert.ok(left.axisY > 0.99 && Math.abs(left.angle - 0.2) < 1e-9);
    const up = computeAlignmentError(aim, { x: 0, y: Math.sin(0.2), z: -Math.cos(0.2) });
    assert.ok(up.axisX > 0.99 && Math.abs(up.angle - 0.2) < 1e-9);
  });

  it('antiparallel target picks a deterministic yaw axis; parallel gives zero error', () => {
    const aim = { x: 0, y: 0, z: -1 };
    const back = computeAlignmentError(aim, { x: 0, y: 0, z: 1 });
    assert.equal(back.angle, Math.PI);
    assert.equal(back.axisY, 1);
    assert.equal(computeAlignmentError(aim, aim).angle, 0);
  });

  it('projection matches pinhole geometry and flags behind-camera points', () => {
    const q = { x: 0, y: 0, z: 0, w: 1 };
    const origin = { x: 0, y: 0, z: 0 };
    const centre = projectDirectionToScreenOffset(origin, { x: 0, y: 0, z: -1 }, 240, origin, q, 62, VH);
    assert.ok(Math.abs(centre.x) < 1e-9 && Math.abs(centre.y) < 1e-9 && centre.inFront);
    const ang = Math.atan(100 / focalLengthPx(VH, 62));
    const right = projectDirectionToScreenOffset(origin, { x: Math.sin(ang), y: 0, z: -Math.cos(ang) }, 240, origin, q, 62, VH);
    assert.ok(Math.abs(right.x - 100) < 1e-6);
    const up = projectDirectionToScreenOffset(origin, { x: 0, y: Math.sin(ang), z: -Math.cos(ang) }, 240, origin, q, 62, VH);
    assert.ok(Math.abs(up.y + 100) < 1e-6, 'screen +y is down, so up is negative');
    const behind = projectDirectionToScreenOffset(origin, { x: 0.3, y: 0, z: 0.95 }, 240, origin, q, 62, VH);
    assert.ok(!behind.inFront && behind.x > 1000);
  });

  it('response curve is zero at zero error, monotonic, and saturates below 1', () => {
    let prev = -1;
    for (let a = 0; a <= 3; a += 0.01) {
      const r = evaluateAlignmentResponse(a, F, VH, RESPONSE);
      assert.ok(r.demand >= prev - 1e-12 && r.demand <= 1);
      prev = r.demand;
    }
    assert.equal(evaluateAlignmentResponse(0, F, VH, RESPONSE).demand, 0);
  });
});

describe('mouse-to-reticle alignment loop (simulation)', () => {
  it('idle: zero error, zero rates, V and R coincide', () => {
    const s = new Sim();
    s.run(1);
    assert.ok(s.errorAngle() < 1e-12 && Math.abs(s.yawRate) < 1e-12);
    const r = s.screenR(), v = s.screenV();
    assert.ok(Math.hypot(r.x - v.x, r.y - v.y) < 1e-6);
  });

  it('small movement inside the boundary: proportional, no jitter, converges', () => {
    const s = new Sim();
    flick(s, 40, 0, 2);
    const initialErr = s.errorAngle();
    assert.ok(initialErr > 0.03 && initialErr < 0.07);
    let prev = initialErr;
    for (let i = 0; i < 240; i++) {
      s.step(DT);
      assert.ok(s.errorAngle() <= prev + 2e-4, 'error must not grow');
      prev = s.errorAngle();
    }
    assert.ok(s.errorAngle() < 1e-3);
  });

  for (const [name, dx, dy] of [
    ['right boundary crossing', 300, 0],
    ['left boundary crossing', -300, 0],
    ['upward', 0, -220],
    ['downward', 0, 220],
    ['diagonal', 260, -190],
  ] as const) {
    it(`${name}: ship keeps turning after the mouse stops; error shrinks monotonically to ~0`, () => {
      const s = new Sim();
      const start = s.forward();
      flick(s, dx, dy);
      const targetAtStop = { ...s.target };
      const expected = Math.hypot(dx, dy) / F;

      // V was dragged beyond the 30%-wide aim boundary for horizontal cases (screen px)
      if (Math.abs(dx) >= 260) assert.ok(Math.abs(s.screenV().x) > BOUNDARY_HALF_W, 'V outside boundary');

      // Mouse is now at rest. Ship must still be rotating and error must still be large.
      const errAtStop = s.errorAngle();
      assert.ok(errAtStop > 0.6 * expected, 'alignment error persists after mouse stops');
      s.step(DT);
      assert.ok(Math.hypot(s.yawRate, s.pitchRate) > 0.3, 'ship still rotating with the mouse at rest');

      let prev = s.errorAngle();
      let screenGapPrev = Math.hypot(s.screenV().x - s.screenR().x, s.screenV().y - s.screenR().y);
      for (let i = 0; i < 360; i++) {
        s.step(DT);
        const e = s.errorAngle();
        assert.ok(e <= prev + 2e-4, `error grew at frame ${i}: ${prev} -> ${e}`);
        prev = e;
        // V is world-fixed: ship/camera motion must never move it
        assert.ok(Math.abs(s.target.x - targetAtStop.x) + Math.abs(s.target.y - targetAtStop.y) + Math.abs(s.target.z - targetAtStop.z) < 1e-9);
        if (i % 30 === 0) {
          const gap = Math.hypot(s.screenV().x - s.screenR().x, s.screenV().y - s.screenR().y);
          assert.ok(gap <= screenGapPrev + 1, 'on-screen V-R gap must not grow');
          screenGapPrev = gap;
        }
      }
      assert.ok(prev < 1e-3, `converged (${prev})`);
      assert.ok(Math.hypot(s.yawRate, s.pitchRate) < 1e-2, 'rotation stops naturally at alignment');
      const turned = angleBetween(start, s.forward());
      assert.ok(Math.abs(turned - expected) / expected < 0.04, `turned ${turned} vs requested ${expected}`);
    });
  }

  it('vertical pitch is as effective as yaw for equal mouse travel (Failure A regression)', () => {
    const up = new Sim(); flick(up, 0, -250); up.run(5);
    const right = new Sim(); flick(right, 250, 0); right.run(5);
    const upTurn = angleBetween({ x: 0, y: 0, z: -1 }, up.forward());
    const rightTurn = angleBetween({ x: 0, y: 0, z: -1 }, right.forward());
    assert.ok(up.forward().y > 0.35, 'nose actually pitched up');
    assert.ok(Math.abs(upTurn - rightTurn) / rightTurn < 0.03);
    // old behaviour capped the turn at the aim-region half-height (126px / focal ~ 0.21 rad)
    assert.ok(upTurn > 0.35);
  });

  it('large mouse movement produces a large turn (old model capped near the boundary angle)', () => {
    const s = new Sim();
    flick(s, 1200, 0, 20);
    s.run(8);
    const turned = angleBetween({ x: 0, y: 0, z: -1 }, s.forward());
    assert.ok(Math.abs(turned - 1200 / F) / (1200 / F) < 0.03);
    assert.ok(turned > 1.9, `turned ${turned} rad`);
    assert.ok(s.errorAngle() < 1e-3);
  });

  it('retargeting during a turn is smooth and converges on the new target', () => {
    const s = new Sim();
    flick(s, 400, 0);
    for (let i = 0; i < 9; i++) s.step(DT); // mid-turn
    s.maxRateJump = 0;
    flick(s, -700, 160, 6); // yank the other way and down
    const alpha = 1 - Math.exp(-DT / TAU);
    assert.ok(s.maxRateJump <= alpha * 2 * MAX_YAW + 1e-9, `rate jump ${s.maxRateJump}`);
    s.run(8);
    assert.ok(s.errorAngle() < 1e-3);
  });

  it('frame-rate independent: 30 FPS and 144 FPS reach the same heading', () => {
    const results = [30, 60, 144].map((fps) => {
      const dt = 1 / fps;
      const s = new Sim();
      const frames = Math.max(1, Math.round(0.1 * fps));
      for (let i = 0; i < frames; i++) s.step(dt, 300 / frames, -120 / frames);
      for (let i = 0; i < 6 * fps; i++) s.step(dt);
      return s.forward();
    });
    assert.ok(angleBetween(results[0], results[1]) < 0.02);
    assert.ok(angleBetween(results[2], results[1]) < 0.02);
  });

  it('screen-relative input holds when the ship is rolled 90 degrees', () => {
    const s = new Sim(qAxis(0, 0, 1, Math.PI / 2));
    const rightAxis = rotateByQuat({ x: 1, y: 0, z: 0 }, s.q, { x: 0, y: 0, z: 0 });
    const before = { ...s.target };
    rotateTargetByMouse(s.target, s.q, 0.3, 0);
    const d = { x: s.target.x - before.x, y: s.target.y - before.y, z: s.target.z - before.z };
    assert.ok(d.x * rightAxis.x + d.y * rightAxis.y + d.z * rightAxis.z > 0.25, 'target moved toward ship-right');
  });

  it('A/D roll during a turn does not break convergence', () => {
    const s = new Sim();
    flick(s, 300, -100);
    for (let i = 0; i < 120; i++) s.step(DT, 0, 0, 1.5);
    s.run(8);
    assert.ok(s.errorAngle() < 2e-3);
  });

  it('on-screen reticle follows its own ray: V approaches R and they meet', () => {
    const s = new Sim();
    flick(s, 320, 0);
    const startGap = Math.abs(s.screenV().x - s.screenR().x);
    assert.ok(startGap > 250);
    s.run(6);
    const gap = Math.hypot(s.screenV().x - s.screenR().x, s.screenV().y - s.screenR().y);
    assert.ok(gap < 1, `final screen gap ${gap}px`);
  });
});
