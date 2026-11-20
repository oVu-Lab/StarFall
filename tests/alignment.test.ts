// Projection-aware regression coverage for STARFALL mouse-to-reticle alignment.
// Run: node_modules/.bin/tsx tests/alignment.test.ts
import * as THREE from 'three';
import { CameraController } from '../src/engine/CameraController';
import { clampToRoundedRect, createRoundedRectClampResult } from '../src/engine/AimBoundary';
import { CombatManager } from '../src/engine/combat/CombatManager';
import { evaluateAlignmentProgressiveResponse, FlightController, createInitialTelemetry } from '../src/engine/FlightController';
import { WEAPON_CONFIGS } from '../src/config/weapons';
import { DEFAULT_SETTINGS, SHIP_CONFIGS } from '../src/config/ships';
import { STEERING_CONFIG } from '../src/config/steering';
import type { InputSnapshot } from '../src/engine/InputManager';

const ship = SHIP_CONFIGS.interceptor;
const dt = 1 / 60;
const width = 1280;
const height = 720;
let failures = 0;

function check(name: string, passed: boolean, details = ''): void {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${details ? `  ${details}` : ''}`);
  if (!passed) failures += 1;
}

function blankInput(): InputSnapshot {
  return {
    forward: false, backward: false, rollLeft: false, rollRight: false, boost: false,
    firePrimary: false, keyPitchUp: false, keyPitchDown: false, keyYawLeft: false,
    keyYawRight: false, mouseDeltaX: 0, mouseDeltaY: 0, stickX: 0, stickY: 0,
    stickMagnitude: 0, steerYaw: 0, steerPitch: 0, steeringZone: 'deadzone', pointerLocked: true,
  };
}

function verifyCameraRollFollowing(): void {
  for (const [degrees, expectedUpY] of [[90, 0], [180, -1]] as const) {
    const flight = new FlightController(ship);
    const telemetry = createInitialTelemetry(ship);
    const camera = new THREE.PerspectiveCamera(62, width / height, 0.25, 4200);
    const controller = new CameraController();
    controller.snapToShip(flight, camera, DEFAULT_SETTINGS.cameraDistance);
    const before = camera.quaternion.clone();
    flight.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(degrees));
    // Keep yaw/pitch follow gated as it is during active mouse alignment.
    flight.steeringError.magnitude = 20;
    flight.yawVelocity = 0.2;
    controller.updateChase(dt, flight, camera, DEFAULT_SETTINGS, 0, 0);
    camera.updateMatrixWorld();
    const shipUp = new THREE.Vector3(0, 1, 0).applyQuaternion(flight.quaternion);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const actualDelta = camera.quaternion.clone().multiply(before.clone().invert());
    check(`${degrees}° ship roll follows camera through active steering gate`,
      camUp.dot(shipUp) > 0.995 && actualDelta.angleTo(flight.quaternion) < 0.08,
      `camera-up dot ship-up=${camUp.dot(shipUp).toFixed(4)}`);
    const aim = flight.getAimTargetPoint(new THREE.Vector3(), WEAPON_CONFIGS.player_pulse_twin.convergenceDistance).project(camera);
    const x = (aim.x + 1) * width * 0.5;
    const y = (1 - aim.y) * height * 0.5;
    const boundary = flight.aimBoundary;
    check(`${degrees}° rolled camera keeps projected T inside Boundary`,
      Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - width / 2) <= boundary.halfW + 0.01 && Math.abs(y - height / 2) <= boundary.halfH + 0.01,
      `T=(${(x - width / 2).toFixed(1)},${(y - height / 2).toFixed(1)})`);
    flight.syncAimProjection(camera, telemetry, width, height);
    check(`${degrees}° rolled camera projection feedback matches reticle`,
      Math.abs(telemetry.aimScreenX - (aim.x + 1) / 2) < 1e-7 && Math.abs(telemetry.aimScreenY - (1 - aim.y) / 2) < 1e-7);
    check(`${degrees}° camera up orientation`, Math.abs(camUp.y - expectedUpY) < 0.001);
  }
}

function verifyFullQuaternionChase(): void {
  for (const degrees of [90, 180, 360]) {
    const flight = new FlightController(ship);
    flight.steeringMode = 'direct-nonlinear';
    const camera = new THREE.PerspectiveCamera(62, width / height, 0.25, 4200);
    const controller = new CameraController();
    controller.snapToShip(flight, camera, DEFAULT_SETTINGS.cameraDistance);
    const shipFrameOffset = flight.quaternion.clone().invert().multiply(camera.quaternion).normalize();
    flight.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(degrees));
    for (let i = 0; i < 80; i++) controller.updateChase(dt, flight, camera, DEFAULT_SETTINGS, 0, 0);
    const expected = flight.quaternion.clone().multiply(shipFrameOffset).normalize();
    const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    check(`${degrees}° ship roll yields full chase attitude`, camera.quaternion.angleTo(expected) < 1e-6,
      `quaternion error=${camera.quaternion.angleTo(expected).toExponential(2)}`);
    if (degrees === 180) check('180° ship roll leaves camera upside down', cameraUp.y < -0.999);
    if (degrees === 360) check('360° ship roll returns camera to original attitude', camera.quaternion.angleTo(shipFrameOffset) < 1e-6);
    const localPosition = camera.position.clone().sub(flight.position).applyQuaternion(flight.quaternion.clone().invert());
    check(`${degrees}° camera position remains in ship-local chase frame`,
      Math.abs(localPosition.x) < 0.01 && localPosition.y > 1 && localPosition.z > 0,
      `local offset=(${localPosition.x.toFixed(2)},${localPosition.y.toFixed(2)},${localPosition.z.toFixed(2)})`);
  }

  const flight = new FlightController(ship);
  flight.steeringMode = 'direct-nonlinear';
  const camera = new THREE.PerspectiveCamera(62, width / height, 0.25, 4200);
  const controller = new CameraController();
  controller.snapToShip(flight, camera, DEFAULT_SETTINGS.cameraDistance);
  const localFrame = flight.quaternion.clone().invert().multiply(camera.quaternion).normalize();
  flight.quaternion.setFromEuler(new THREE.Euler(0.63, -0.81, 1.27, 'XYZ'));
  controller.updateChase(dt, flight, camera, DEFAULT_SETTINGS, 0, 0);
  const expected = flight.quaternion.clone().multiply(localFrame).normalize();
  check('combined yaw, pitch, and roll follow ship quaternion', camera.quaternion.angleTo(expected) < 1e-6);

  const loopFlight = new FlightController(ship);
  loopFlight.steeringMode = 'direct-nonlinear';
  const loopCamera = new THREE.PerspectiveCamera(62, width / height, 0.25, 4200);
  const loopController = new CameraController();
  loopController.snapToShip(loopFlight, loopCamera, DEFAULT_SETTINGS.cameraDistance);
  const loopFrame = loopFlight.quaternion.clone().invert().multiply(loopCamera.quaternion).normalize();
  for (let quarterTurn = 1; quarterTurn <= 4; quarterTurn++) {
    loopFlight.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), quarterTurn * Math.PI / 2);
    loopController.updateChase(dt, loopFlight, loopCamera, DEFAULT_SETTINGS, 0, 0);
  }
  check('successive quarter-turns complete a 360° camera roll', loopCamera.quaternion.angleTo(loopFrame) < 1e-6);
}

function runAxis(axis: 'yaw' | 'pitch'): void {
  const flight = new FlightController(ship);
  const telemetry = createInitialTelemetry(ship);
  const camera = new THREE.PerspectiveCamera(62, width / height, 0.25, 4200);
  const cameraController = new CameraController();
  const input = blankInput();
  cameraController.snapToShip(flight, camera, DEFAULT_SETTINGS.cameraDistance);
  camera.updateMatrixWorld();
  flight.syncAimProjection(camera, telemetry, width, height);

  const step = (dx: number, dy: number) => {
    input.mouseDeltaX = dx;
    input.mouseDeltaY = dy;
    flight.update(dt, input, DEFAULT_SETTINGS, telemetry, width, height, camera);
    cameraController.updateChase(dt, flight, camera, DEFAULT_SETTINGS, telemetry.boostIntensity, 0);
    camera.updateMatrixWorld();
    flight.syncAimProjection(camera, telemetry, width, height);
  };
  const horizontal = axis === 'yaw';
  const turnRate = () => horizontal ? flight.steeringDemand.targetYawRate : flight.steeringDemand.targetPitchRate;
  const virtualAxis = () => horizontal ? flight.virtualMouse.x : flight.virtualMouse.y;
  const reticleAxis = () => horizontal ? flight.reticlePosition.x : flight.reticlePosition.y;
  const halfBoundary = () => horizontal ? flight.aimBoundary.halfW : flight.aimBoundary.halfH;

  // A/B/C: gradual crossing and a 200 CSS-pixel overshoot keep V free and R bounded.
  step(horizontal ? 400 : 0, horizontal ? 0 : 400);
  check(`[${axis}] virtual mouse remains well beyond boundary after real-rotation feedback`, Math.abs(virtualAxis()) > halfBoundary() + 120, `V=${virtualAxis().toFixed(1)} half=${halfBoundary().toFixed(1)}`);
  check(`[${axis}] real projected reticle remains bounded`, Math.abs(reticleAxis()) <= halfBoundary() + 0.01, `R=${reticleAxis().toFixed(1)} half=${halfBoundary().toFixed(1)}`);
  check(`[${axis}] alignment demand exists beyond boundary`, Math.abs(turnRate()) > 0.04, `rate=${turnRate().toFixed(3)} rad/s`);

  // D/E/F: with the mouse stopped, actual ship rotation feeds back into V and closes the loop.
  const virtualBefore = { ...flight.virtualMouse };
  const errorBefore = flight.steeringError.magnitude;
  const reticleBefore = reticleAxis();
  const shipBeforeCatchUp = flight.quaternion.clone();
  const cameraBeforeCatchUp = camera.quaternion.clone();
  let turn = 0;
  let sawReticleMove = false;
  for (let i = 0; i < 50; i += 1) {
    step(0, 0);
    turn += (horizontal ? flight.yawVelocity : flight.pitchVelocity) * dt;
    if (Math.abs(reticleAxis() - reticleBefore) > 0.01) sawReticleMove = true;
  }
  check(`[${axis}] continues turning after mouse stop`, Math.abs(turn) > 0.015, `turn=${THREE.MathUtils.radToDeg(turn).toFixed(1)}°`);
  check(`[${axis}] ship rotation moves V toward T`, Math.hypot(flight.virtualMouse.x - virtualBefore.x, flight.virtualMouse.y - virtualBefore.y) > 1);
  check(`[${axis}] reticle motion comes from actual rotation`, sawReticleMove);
  check(`[${axis}] alignment error decreases`, flight.steeringError.magnitude < errorBefore * 0.1, `${errorBefore.toFixed(1)} -> ${flight.steeringError.magnitude.toFixed(1)} px`);

  // G/H: firing direction and HUD location are an identical camera projection.
  const aimPoint = flight.getAimTargetPoint(new THREE.Vector3(), WEAPON_CONFIGS.player_pulse_twin.convergenceDistance).project(camera);
  const aimX = (aimPoint.x + 1) * 0.5;
  const aimY = (1 - aimPoint.y) * 0.5;
  check(
    `[${axis}] firing ray matches displayed reticle`,
    Math.abs(aimX - telemetry.aimScreenX) < 0.002 && Math.abs(aimY - telemetry.aimScreenY) < 0.002,
    `ray=(${aimX.toFixed(4)},${aimY.toFixed(4)}) hud=(${telemetry.aimScreenX.toFixed(4)},${telemetry.aimScreenY.toFixed(4)})`,
  );

  // F: this is the active runtime integration path: FlightController, camera tracking,
  // camera projection and weapon aim all advance together with no further mouse input.
  const shipBeforePersistentTurn = flight.quaternion.clone();
  const cameraBeforePersistentTurn = camera.quaternion.clone();
  for (let i = 0; i < 150; i += 1) step(0, 0);
  const actualShipTurn = shipBeforeCatchUp.angleTo(flight.quaternion);
  const actualCameraTurn = cameraBeforeCatchUp.angleTo(camera.quaternion);
  check(`[${axis}] ship and camera transform during catch-up`, actualShipTurn > 0.1 && actualCameraTurn > 0.01, `ship=${THREE.MathUtils.radToDeg(actualShipTurn).toFixed(1)}° camera=${THREE.MathUtils.radToDeg(actualCameraTurn).toFixed(1)}°`);
  check(`[${axis}] target catches reticle without more input`, flight.steeringError.magnitude < 1, `error=${flight.steeringError.magnitude.toFixed(2)}px`);
  const settledQuaternion = flight.quaternion.clone();
  for (let i = 0; i < 120; i += 1) step(0, 0);
  check(`[${axis}] ship rotation settles after alignment`, settledQuaternion.angleTo(flight.quaternion) < 0.01, `drift=${THREE.MathUtils.radToDeg(settledQuaternion.angleTo(flight.quaternion)).toFixed(2)}°`);
  check(`[${axis}] T remains within the boundary during persistent turn`, Math.abs(flight.reticlePosition.x) <= flight.aimBoundary.halfW + 0.01 && Math.abs(flight.reticlePosition.y) <= flight.aimBoundary.halfH + 0.01);

  // Regression: do not confuse a boundary-clamped comparison with actual marker alignment.
  const trueGap = Math.hypot(
    (telemetry.virtualMouseScreenX - telemetry.aimScreenX) * width,
    (telemetry.virtualMouseScreenY - telemetry.aimScreenY) * height,
  );
  check(`[${axis}] actual marker gap reaches zero`, trueGap < 1, `actual gap=${trueGap.toFixed(1)} px`);
  check(`[${axis}] reported error describes the actual marker gap`,
    Math.abs(flight.steeringError.magnitude - trueGap) < 2,
    `reported=${flight.steeringError.magnitude.toFixed(1)} actual=${trueGap.toFixed(1)} px`);

  // I: reversal uses the same persistent error state; there is no boundary reset.
  const beforeReverseV = virtualAxis();
  for (let i = 0; i < 36; i += 1) step(horizontal ? -8 : 0, horizontal ? 0 : -8);
  check(`[${axis}] reverse motion is accumulated rather than reset`, Math.abs(virtualAxis() - beforeReverseV) > 100);
}

function runCombinedAxes(): void {
  const flight = new FlightController(ship);
  const telemetry = createInitialTelemetry(ship);
  const camera = new THREE.PerspectiveCamera(62, width / height, 0.25, 4200);
  const cameraController = new CameraController();
  const input = blankInput();
  cameraController.snapToShip(flight, camera, DEFAULT_SETTINGS.cameraDistance);
  camera.updateMatrixWorld();
  flight.syncAimProjection(camera, telemetry, width, height);

  const step = (dx: number, dy: number) => {
    input.mouseDeltaX = dx;
    input.mouseDeltaY = dy;
    flight.update(dt, input, DEFAULT_SETTINGS, telemetry, width, height, camera);
    cameraController.updateChase(dt, flight, camera, DEFAULT_SETTINGS, telemetry.boostIntensity, 0);
    camera.updateMatrixWorld();
    flight.syncAimProjection(camera, telemetry, width, height);
  };

  // Small, simultaneous corrections must produce live two-axis response before any boundary.
  step(3, -2);
  check('small two-axis correction produces yaw demand', Math.abs(flight.steeringDemand.targetYawRate) > 0.001);
  check('small two-axis correction produces pitch demand', Math.abs(flight.steeringDemand.targetPitchRate) > 0.001);
  check('small two-axis correction keeps reticle inside boundary', flight.aimClamp.inside);

  // A large diagonal command exercises simultaneous yaw/pitch catch-up and keeps all screen
  // values finite—the same condition used while tracking an enemy with a lead pip.
  let sawBothRates = false;
  for (let i = 0; i < 84; i += 1) {
    step(5, -4);
    if (Math.abs(flight.yawVelocity) > 0.03 && Math.abs(flight.pitchVelocity) > 0.03) sawBothRates = true;
  }
  const finiteTelemetry = [
    telemetry.aimScreenX, telemetry.aimScreenY,
    telemetry.virtualMouseScreenX, telemetry.virtualMouseScreenY,
    telemetry.alignmentErrorPx,
  ].every(Number.isFinite);
  check('large diagonal command keeps both markers finite', finiteTelemetry);
  check('large diagonal command yields both angular rates', sawBothRates);
}

function verifyCameraDoesNotFollowFromBoundaryClampedError(): void {
  const flight = new FlightController(ship);
  const telemetry = createInitialTelemetry(ship);
  const camera = new THREE.PerspectiveCamera(62, width / height, 0.25, 4200);
  const cameraController = new CameraController();
  cameraController.snapToShip(flight, camera, DEFAULT_SETTINGS.cameraDistance);
  flight.alignmentRemaining.magnitude = 0;
  flight.steeringError.magnitude = 100;
  flight.yawVelocity = 1;
  flight.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.01));
  const cameraBefore = camera.quaternion.clone();
  cameraController.updateChase(dt, flight, camera, DEFAULT_SETTINGS, telemetry.boostIntensity, 0);
  const cameraRotation = cameraBefore.angleTo(camera.quaternion);
  check('camera follow stays off when boundary-clamped error is zero but actual V-T error is large', cameraRotation < 1e-8,
    `rotation=${THREE.MathUtils.radToDeg(cameraRotation).toFixed(4)}°`);
}

function traceLargeFlickExecution(): void {
  const { flight, telemetry, camera, step } = (() => {
    const flight = new FlightController(ship);
    const telemetry = createInitialTelemetry(ship);
    const camera = new THREE.PerspectiveCamera(62, width / height, 0.25, 4200);
    const cameraController = new CameraController();
    const input = blankInput();
    cameraController.snapToShip(flight, camera, DEFAULT_SETTINGS.cameraDistance);
    camera.updateMatrixWorld();
    flight.syncAimProjection(camera, telemetry, width, height);
    return {
      flight, telemetry, camera,
      step: (dx: number, dy: number) => {
        input.mouseDeltaX = dx;
        input.mouseDeltaY = dy;
        flight.update(dt, input, DEFAULT_SETTINGS, telemetry, width, height, camera);
        cameraController.updateChase(dt, flight, camera, DEFAULT_SETTINGS, telemetry.boostIntensity, 0);
        camera.updateMatrixWorld();
        flight.syncAimProjection(camera, telemetry, width, height);
      },
    };
  })();
  const rows: string[] = [];
  let rateAgreement = true;
  let cameraRotationNotOverwhelmingHull = true;
  let cameraMotionDeg = 0;
  let hullMotionDeg = 0;
  let previousAppliedYaw = 0;
  let previousAppliedPitch = 0;
  let framesToNinetyPercent = 0;
  let previousT = { x: flight.reticlePosition.x, y: flight.reticlePosition.y };
  for (let frame = 1; frame <= 10; frame += 1) {
    const beforeShip = flight.quaternion.clone();
    const beforeCamera = camera.quaternion.clone();
    step(frame === 1 ? 400 : 0, 0);
    const delta = beforeShip.invert().multiply(flight.quaternion).normalize();
    const euler = new THREE.Euler().setFromQuaternion(delta, 'YXZ');
    const actualYawRate = euler.y / dt;
    const actualPitchRate = euler.x / dt;
    const actualMagnitude = delta.angleTo(new THREE.Quaternion()) / dt;
    hullMotionDeg += THREE.MathUtils.radToDeg(actualMagnitude * dt);
    const cameraDelta = beforeCamera.angleTo(camera.quaternion);
    cameraMotionDeg += THREE.MathUtils.radToDeg(cameraDelta);
    const tDeltaX = flight.reticlePosition.x - previousT.x;
    const tDeltaY = flight.reticlePosition.y - previousT.y;
    const tDeltaPx = Math.hypot(tDeltaX, tDeltaY);
    const appliedMagnitude = Math.hypot(flight.yawVelocity, flight.pitchVelocity);
    const requestedMagnitude = Math.hypot(flight.steeringDemand.targetYawRate, flight.steeringDemand.targetPitchRate);
    const appliedYawAcceleration = (flight.yawVelocity - previousAppliedYaw) / dt;
    const appliedPitchAcceleration = (flight.pitchVelocity - previousAppliedPitch) / dt;
    if (!framesToNinetyPercent && requestedMagnitude > 0.1 && appliedMagnitude >= requestedMagnitude * 0.9) {
      framesToNinetyPercent = frame;
    }
    if (Math.abs(actualMagnitude - appliedMagnitude) > 0.08) rateAgreement = false;
    rows.push([
      frame,
      flight.steeringError.magnitude.toFixed(1),
      flight.steeringDemand.targetYawRate.toFixed(2),
      flight.steeringDemand.targetPitchRate.toFixed(2),
      flight.yawVelocity.toFixed(2),
      flight.pitchVelocity.toFixed(2),
      appliedYawAcceleration.toFixed(1),
      appliedPitchAcceleration.toFixed(1),
      THREE.MathUtils.radToDeg(actualYawRate).toFixed(1),
      THREE.MathUtils.radToDeg(actualPitchRate).toFixed(1),
      THREE.MathUtils.radToDeg(actualMagnitude).toFixed(1),
      THREE.MathUtils.radToDeg(cameraDelta / dt).toFixed(1),
      tDeltaPx.toFixed(1),
      `${flight.reticlePosition.x.toFixed(1)},${flight.reticlePosition.y.toFixed(1)}`,
    ].join(','));
    if (!Number.isFinite(cameraDelta) || !Number.isFinite(tDeltaPx)) rateAgreement = false;
    previousAppliedYaw = flight.yawVelocity;
    previousAppliedPitch = flight.pitchVelocity;
    previousT = { x: flight.reticlePosition.x, y: flight.reticlePosition.y };
  }
  console.log('TRACE large flick then no input: frame,errorPx,requestedYaw,requestedPitch,appliedYaw,appliedPitch,accelYaw,accelPitch,measuredYawDegPerSec,measuredPitchDegPerSec,measuredTotalDegPerSec,cameraDegPerSec,TdeltaPx,TpxX,TpxY');
  for (const row of rows) console.log(`TRACE ${row}`);
  cameraRotationNotOverwhelmingHull = cameraMotionDeg < hullMotionDeg * 0.25;
  check('quaternion integration delivers requested angular rates to the real hull', rateAgreement,
    `last target=${Math.hypot(flight.steeringDemand.targetYawRate, flight.steeringDemand.targetPitchRate).toFixed(2)}rad/s actual=${(Math.hypot(flight.yawVelocity, flight.pitchVelocity)).toFixed(2)}rad/s`);
  check('large flick reaches 90% of its commanded rate within one frame', framesToNinetyPercent === 1,
    `frames=${framesToNinetyPercent || 'not reached'}`);
  check('camera projection does not cancel most of measured hull rotation', cameraRotationNotOverwhelmingHull,
    `camera=${cameraMotionDeg.toFixed(2)}° hull=${hullMotionDeg.toFixed(2)}° across ten frames`);
  check('large flick produces measurable real ship rotation over ten frames', flight.quaternion.angleTo(new THREE.Quaternion()) > 0.1,
    `camera moved ${cameraMotionDeg.toFixed(2)}°; final T=(${previousT.x.toFixed(1)},${previousT.y.toFixed(1)})px`);
}

runAxis('yaw');
runAxis('pitch');
verifyCameraRollFollowing();
verifyFullQuaternionChase();
runCombinedAxes();
verifyCameraDoesNotFollowFromBoundaryClampedError();
traceLargeFlickExecution();

function regressionScenarios(): void {
  const make = () => {
    const flight = new FlightController(ship);
    const telemetry = createInitialTelemetry(ship);
    const camera = new THREE.PerspectiveCamera(62, width / height, 0.25, 4200);
    const cameraController = new CameraController();
    const input = blankInput();
    cameraController.snapToShip(flight, camera, DEFAULT_SETTINGS.cameraDistance);
    flight.syncAimProjection(camera, telemetry, width, height);
    const step = (dx = 0, dy = 0) => {
      input.mouseDeltaX = dx; input.mouseDeltaY = dy;
      flight.update(dt, input, DEFAULT_SETTINGS, telemetry, width, height, camera);
      cameraController.updateChase(dt, flight, camera, DEFAULT_SETTINGS, telemetry.boostIntensity, 0);
      flight.syncAimProjection(camera, telemetry, width, height);
    };
    return { flight, telemetry, camera, cameraController, input, step };
  };
  {
    const smallPx = height * 0.03;
    const mediumPx = height * 0.15;
    const largePx = height * 0.45;
    const smallResponse = evaluateAlignmentProgressiveResponse(smallPx, height);
    const mediumResponse = evaluateAlignmentProgressiveResponse(mediumPx, height);
    const largeResponse = evaluateAlignmentProgressiveResponse(largePx, height);
    const samples = [0, 0.01, 0.03, 0.15, 0.3, 0.6, 1.2].map(fraction =>
      evaluateAlignmentProgressiveResponse(height * fraction, height));
    const ratesForError = (errorPx: number, axis: 'yaw' | 'pitch' = 'yaw'): { yaw: number; pitch: number } => {
      const { flight, telemetry, camera, input } = make();
      if (axis === 'yaw') flight.virtualMouse.x = flight.reticlePosition.x + errorPx;
      else flight.virtualMouse.y = flight.reticlePosition.y - errorPx;
      flight.update(dt, input, DEFAULT_SETTINGS, telemetry, width, height, camera);
      return {
        yaw: Math.abs(flight.steeringDemand.targetYawRate),
        pitch: Math.abs(flight.steeringDemand.targetPitchRate),
      };
    };
    const smallRate = ratesForError(smallPx);
    const mediumRate = ratesForError(mediumPx);
    const largeRate = ratesForError(largePx);
    const smallPitchRate = ratesForError(smallPx, 'pitch').pitch;
    const mediumPitchRate = ratesForError(mediumPx, 'pitch').pitch;
    const largePitchRate = ratesForError(largePx, 'pitch').pitch;
    check('progressive response uses n=error/(0.3*H) and tanh(n*(1+0.9*n))',
      Math.abs(smallResponse - Math.tanh(0.1 * (1.0 + 1.6 * 0.1))) < 1e-12 &&
      Math.abs(mediumResponse - Math.tanh(0.5 * (1.0 + 1.6 * 0.5))) < 1e-12 &&
      Math.abs(largeResponse - Math.tanh(1.5 * (1.0 + 1.6 * 1.5))) < 1e-12);
    check('progressive response is monotonic', samples.every((value, index) => index === 0 || value >= samples[index - 1]));
    check('progressive response smoothly approaches maximum', largeResponse > 0.99 && largeResponse <= 1 && samples.at(-1)! > 0.999999);
    check('small error produces gentle, controllable yaw and pitch rates', smallRate.yaw > 0 && smallRate.yaw < mediumRate.yaw && smallPitchRate > 0 && smallPitchRate < mediumPitchRate,
      `e=${smallPx.toFixed(0)}px yaw=${smallRate.yaw.toFixed(3)} pitch=${smallPitchRate.toFixed(3)}rad/s`);
    check('medium error produces stronger yaw and pitch rates', mediumRate.yaw > smallRate.yaw * 2 && mediumPitchRate > smallPitchRate * 2,
      `e=${mediumPx.toFixed(0)}px yaw=${mediumRate.yaw.toFixed(3)} pitch=${mediumPitchRate.toFixed(3)}rad/s`);
    check('extreme error produces near-maximum yaw and pitch rates', largeRate.yaw > mediumRate.yaw * 1.2 && largePitchRate > mediumPitchRate * 1.2,
      `e=${largePx.toFixed(0)}px yaw=${largeRate.yaw.toFixed(3)} pitch=${largePitchRate.toFixed(3)}rad/s`);
    check('configured ship-rate ceilings are reachable and independently tunable',
      STEERING_CONFIG.maxYawRate === 5.5 && STEERING_CONFIG.maxPitchRate === 5.0 &&
      largeRate.yaw > DEFAULT_SETTINGS.maxYawRate * 0.98 && largePitchRate > DEFAULT_SETTINGS.maxPitchRate * DEFAULT_SETTINGS.pitchSensitivity * 0.99,
      `configured=${STEERING_CONFIG.maxYawRate.toFixed(2)}/${STEERING_CONFIG.maxPitchRate.toFixed(2)} effective=${largeRate.yaw.toFixed(3)}/${largePitchRate.toFixed(3)}rad/s`);
  }
  {
    const { flight, step } = make();
    step(400, 0);
    check('fast viewport flick produces target beyond the boundary', Math.abs(flight.virtualMouse.x) > flight.aimBoundary.halfW);
    check('steering is already active on boundary-crossing input', Math.abs(flight.steeringDemand.targetYawRate) > 0.1,
      `rate=${flight.steeringDemand.targetYawRate.toFixed(3)}rad/s`);
    let framesToBoundary = 0;
    while (framesToBoundary < 60 && flight.alignmentRemaining.magnitude > 5) {
      step();
      framesToBoundary += 1;
    }
    check('real projected reticle reaches boundary quickly after a viewport flick', framesToBoundary <= 8,
      `frames=${framesToBoundary} remaining=${flight.alignmentRemaining.magnitude.toFixed(2)}px`);
    check('fast flick keeps T inside Boundary', Math.abs(flight.reticlePosition.x) <= flight.aimBoundary.halfW + 0.01 && Math.abs(flight.reticlePosition.y) <= flight.aimBoundary.halfH + 0.01);
  }
  for (const [name, dx, dy] of [
    ['up', 0, -5], ['down', 0, 5], ['left', -5, 0], ['right', 5, 0], ['diagonal', 5, -4],
  ] as const) {
    const { flight, step } = make();
    for (let i = 0; i < 7; i++) step(dx * 10, dy * 10);
    const v = { ...flight.virtualMouse };
    const q = flight.quaternion.clone();
    const err = flight.steeringError.magnitude;
    for (let i = 0; i < 25; i++) step();
    check(`${name}: ship keeps rotating after stop`, q.angleTo(flight.quaternion) > 0.01);
    check(`${name}: ship rotation moves V toward T`, Math.hypot(flight.virtualMouse.x - v.x, flight.virtualMouse.y - v.y) > 0.1);
    check(`${name}: gap shrinks`, flight.steeringError.magnitude < err * 0.25, `${err.toFixed(1)} -> ${flight.steeringError.magnitude.toFixed(1)}px`);
    for (let i = 0; i < 600; i++) step();
    check(`${name}: target and reticle align after stop`, flight.steeringError.magnitude < 1, `error=${flight.steeringError.magnitude.toFixed(2)}px`);
    const settled = flight.quaternion.clone();
    for (let i = 0; i < 90; i++) step();
    check(`${name}: ship settles after catching target`, settled.angleTo(flight.quaternion) < 0.01, `drift=${settled.angleTo(flight.quaternion).toFixed(4)}rad`);
    check(`${name}: T remains inside the boundary`, Math.abs(flight.reticlePosition.x) <= flight.aimBoundary.halfW + 0.01 && Math.abs(flight.reticlePosition.y) <= flight.aimBoundary.halfH + 0.01);
  }
  {
    const { flight, telemetry, camera, input } = make();
    const oldReticle = { x: flight.reticlePosition.x, y: flight.reticlePosition.y };
    input.mouseDeltaX = 100;
    input.mouseDeltaY = -70;
    flight.update(1e-9, input, DEFAULT_SETTINGS, telemetry, width, height, camera);
    check('mouse updates V without moving HUD T directly', Math.abs(flight.virtualMouse.x - 100) < 0.01 && Math.abs(flight.virtualMouse.y + 70) < 0.01 && flight.reticlePosition.x === oldReticle.x && flight.reticlePosition.y === oldReticle.y);
  }
  {
    const { flight, step } = make();
    const before = flight.quaternion.clone();
    step(3, -2);
    for (let i = 0; i < 300; i++) step();
    const angle = before.angleTo(flight.quaternion);
    check('small correction is controllable', angle > 0.001 && angle < 0.1, `angle=${angle.toFixed(4)}`);
  }
  {
    const { flight, step } = make();
    const before = flight.quaternion.clone();
    for (let i = 0; i < 200; i++) step(5, 0);
    for (let i = 0; i < 600; i++) step();
    check('large displacement produces substantial turn to boundary', before.angleTo(flight.quaternion) > 0.5, `turn=${before.angleTo(flight.quaternion).toFixed(2)}rad`);
    check('large displacement eventually aligns and settles', flight.steeringError.magnitude < 1, `error=${flight.steeringError.magnitude.toFixed(2)}px`);
  }
  {
    const { flight, step } = make();
    const initial = flight.quaternion.clone();
    for (let i = 0; i < 720; i++) step(5, 0);
    for (let i = 0; i < 1200; i++) step();
    check('very large target feeds back to the boundary and settles', flight.steeringError.magnitude < 1, `V=${flight.virtualMouse.x.toFixed(0)} gap=${flight.steeringError.magnitude.toFixed(1)} angle=${initial.angleTo(flight.quaternion).toFixed(2)}`);
  }
  {
    const { flight, step } = make();
    for (let i = 0; i < 160; i++) step(4, 0);
    for (let i = 0; i < 450; i++) step();
    for (let i = 0; i < 160; i++) step(-4, 0);
    for (let i = 0; i < 600; i++) step();
    check('reversal after large turn converges', flight.steeringError.magnitude < 1, `gap=${flight.steeringError.magnitude.toFixed(2)}`);
  }
  {
    const { flight, telemetry, camera, cameraController, input, step } = make();
    for (let i = 0; i < 18; i++) step(8, -3);
    const oldTarget = { ...flight.virtualMouse };
    const errorBeforeRetarget = flight.steeringError.magnitude;
    input.mouseDeltaX = -35;
    input.mouseDeltaY = 18;
    flight.update(dt, input, DEFAULT_SETTINGS, telemetry, width, height, camera);
    check('new mouse input during alignment retargets V immediately',
      flight.virtualMouse.x < oldTarget.x - 30 && flight.virtualMouse.y > oldTarget.y + 15,
      `V=(${flight.virtualMouse.x.toFixed(1)},${flight.virtualMouse.y.toFixed(1)})`);
    cameraController.updateChase(dt, flight, camera, DEFAULT_SETTINGS, telemetry.boostIntensity, 0);
    camera.updateMatrixWorld();
    flight.syncAimProjection(camera, telemetry, width, height);
    check('retarget keeps a live steering error', flight.steeringError.magnitude > 0 && Number.isFinite(errorBeforeRetarget));
    for (let i = 0; i < 600; i++) step();
    check('retargeted target aligns after input stops', flight.steeringError.magnitude < 1, `error=${flight.steeringError.magnitude.toFixed(2)}px`);
  }
  {
    const { flight, camera, step } = make();
    step(300, -180);
    const firstError = flight.steeringError.magnitude;
    const firstVirtual = { ...flight.virtualMouse };
    const oldShipRotation = flight.quaternion.clone();
    const oldCameraFrame = camera.clone();
    oldCameraFrame.updateMatrixWorld();
    step();
    const actualAngularDisplacement = oldShipRotation.angleTo(flight.quaternion);
    const staleViewOldPoint = new THREE.Vector3(0, 0, -1).applyQuaternion(oldShipRotation)
      .multiplyScalar(WEAPON_CONFIGS.player_pulse_twin.convergenceDistance)
      .add(flight.position)
      .project(oldCameraFrame);
    const staleViewNewPoint = flight.getAimTargetPoint(new THREE.Vector3(), WEAPON_CONFIGS.player_pulse_twin.convergenceDistance).project(oldCameraFrame);
    const staleViewDisplacement = Math.hypot(
      (staleViewNewPoint.x - staleViewOldPoint.x) * width * 0.5,
      (staleViewOldPoint.y - staleViewNewPoint.y) * height * 0.5,
    );
    const oldAimPoint = new THREE.Vector3(0, 0, -1).applyQuaternion(oldShipRotation)
      .multiplyScalar(WEAPON_CONFIGS.player_pulse_twin.convergenceDistance)
      .add(flight.position)
      .project(camera);
    const newAimPoint = flight.getAimTargetPoint(new THREE.Vector3(), WEAPON_CONFIGS.player_pulse_twin.convergenceDistance).project(camera);
    const actualScreenDeltaX = (newAimPoint.x - oldAimPoint.x) * width * 0.5;
    const actualScreenDeltaY = (oldAimPoint.y - newAimPoint.y) * height * 0.5;
    const actualWeaponScreenDisplacement = Math.hypot(actualScreenDeltaX, actualScreenDeltaY);
    const feedbackTargetDisplacement = Math.hypot(flight.virtualMouse.x - firstVirtual.x, flight.virtualMouse.y - firstVirtual.y);
    check('feedback equals real ship-only projection displacement through one final camera frame',
      actualAngularDisplacement > 0 && actualWeaponScreenDisplacement > 0 &&
      Math.abs(feedbackTargetDisplacement - actualWeaponScreenDisplacement) < 1e-6 &&
      Math.abs((flight.virtualMouse.x - firstVirtual.x) + actualScreenDeltaX) < 1e-6 &&
      Math.abs((flight.virtualMouse.y - firstVirtual.y) + actualScreenDeltaY) < 1e-6,
      `ship=${THREE.MathUtils.radToDeg(actualAngularDisplacement).toFixed(3)}° prior-camera=${staleViewDisplacement.toFixed(3)}px final-camera=${actualWeaponScreenDisplacement.toFixed(3)}px feedback=${feedbackTargetDisplacement.toFixed(3)}px`);
    check('feedback never claims more displacement than visible ship rotation',
      feedbackTargetDisplacement <= actualWeaponScreenDisplacement + 1e-6,
      `weapon=${actualWeaponScreenDisplacement.toFixed(3)}px feedback=${feedbackTargetDisplacement.toFixed(3)}px`);
    const frameErrors: number[] = [];
    for (let i = 0; i < 8; i++) {
      step();
      frameErrors.push(flight.steeringError.magnitude);
      check(`feedback frame ${i + 1}: real reticle remains bounded`,
        Math.abs(flight.reticlePosition.x) <= flight.aimBoundary.halfW + 0.01 && Math.abs(flight.reticlePosition.y) <= flight.aimBoundary.halfH + 0.01);
    }
    const virtualShift = Math.hypot(flight.virtualMouse.x - firstVirtual.x, flight.virtualMouse.y - firstVirtual.y);
    check('successive no-input frames drive target error down without runaway overshoot',
      frameErrors.every((value, index) => index === 0 || value <= frameErrors[index - 1] * 1.25 + 0.1) && frameErrors.at(-1)! < firstError * 0.02,
      `${firstError.toFixed(1)} -> ${frameErrors.map(v => v.toFixed(1)).join(' -> ')}px`);
    check('actual projected ship rotation moves V toward T', virtualShift > 1, `V shift=${virtualShift.toFixed(1)}px`);
    for (let i = 0; i < 700; i++) step();
    check('closed loop reaches zero error and settles', flight.steeringError.magnitude < 1 && Math.hypot(flight.yawVelocity, flight.pitchVelocity) < 0.01,
      `error=${flight.steeringError.magnitude.toFixed(2)}px rate=${Math.hypot(flight.yawVelocity, flight.pitchVelocity).toFixed(4)}rad/s`);
  }
  {
    const { flight, step } = make();
    for (let i = 0; i < 190; i++) step(1, 0);
    let maxJump = 0;
    let last = flight.steeringDemand.targetYawRate;
    for (let i = 0; i < 8; i++) {
      step(1, 0);
      maxJump = Math.max(maxJump, Math.abs(flight.steeringDemand.targetYawRate - last));
      last = flight.steeringDemand.targetYawRate;
    }
    check('boundary crossing has no demand jump', maxJump < 0.05, `jump=${maxJump.toFixed(4)}`);
  }
  {
    const { flight, step } = make();
    const before = flight.quaternion.clone();
    step(5, -5);
    const turn = before.angleTo(flight.quaternion);
    check('first mouse frame has no orientation jump', turn < 0.03, `step=${turn.toFixed(4)}rad`);
  }
  {
    const { flight, step } = make();
    const clamp = createRoundedRectClampResult();
    let maxOutside = 0, maxProjectionDifference = 0;
    const camera = new THREE.PerspectiveCamera(62, width / height, 0.25, 4200);
    const cameraController = new CameraController();
    const input = blankInput();
    const telemetry = createInitialTelemetry(ship);
    cameraController.snapToShip(flight, camera, DEFAULT_SETTINGS.cameraDistance);
    for (let i = 0; i < 450; i++) {
      input.mouseDeltaX = i < 10 ? 40 : i >= 200 && i < 220 ? -20 : 0;
      input.mouseDeltaY = i < 10 ? -30 : i >= 200 && i < 220 ? 15 : 0;
      flight.update(dt, input, DEFAULT_SETTINGS, telemetry, width, height, camera);
      cameraController.updateChase(dt, flight, camera, DEFAULT_SETTINGS, telemetry.boostIntensity, 0);
      flight.syncAimProjection(camera, telemetry, width, height);
      clampToRoundedRect(flight.reticlePosition.x, flight.reticlePosition.y, flight.aimBoundary, clamp);
      maxOutside = Math.max(maxOutside, clamp.signedDistance);
      const point = flight.getAimTargetPoint(new THREE.Vector3(), WEAPON_CONFIGS.player_pulse_twin.convergenceDistance).project(camera);
      maxProjectionDifference = Math.max(maxProjectionDifference, Math.hypot(point.x * width * 0.5 - flight.reticlePosition.x, -point.y * height * 0.5 - flight.reticlePosition.y));
    }
    check('actual projected reticle stays inside rounded boundary every frame', maxOutside < 0.01, `outside=${maxOutside.toFixed(4)}px`);
    check('bounded reticle never diverges from real weapon projection', maxProjectionDifference < 1e-6);
    check('return inside makes both markers meet', flight.steeringError.magnitude < 1, `gap=${flight.steeringError.magnitude.toFixed(2)}`);
  }
  {
    const { flight, step } = make();
    for (let i = 0; i < 30; i++) step(5, -3);
    for (let i = 0; i < 600; i++) step();
    check('target reaches reticle at rest without spring recentering', flight.steeringError.magnitude < 1);
    const stationary = { ...flight.virtualMouse };
    for (let i = 0; i < 120; i++) step();
    check('virtual target stays settled after alignment', Math.hypot(flight.virtualMouse.x - stationary.x, flight.virtualMouse.y - stationary.y) < 0.5);
    const oldX = flight.virtualMouse.x, oldY = flight.virtualMouse.y;
    const t = createInitialTelemetry(ship);
    const inp = blankInput();
    flight.update(dt, inp, DEFAULT_SETTINGS, t, width * 0.75, height * 0.75);
    check('viewport rescaling preserves normalized V', Math.abs(flight.virtualMouse.x - oldX * 0.75) < 1e-9 && Math.abs(flight.virtualMouse.y - oldY * 0.75) < 1e-9);
  }
  {
    const { flight, telemetry, camera, input, step } = make();
    input.rollLeft = true;
    for (let i = 0; i < 45; i++) step();
    input.rollLeft = false;
    for (let i = 0; i < 180; i++) step();
    for (let i = 0; i < 50; i++) step(4, -3);
    const gap = flight.steeringError.magnitude;
    for (let i = 0; i < 600; i++) step();
    check('roll remains available', Math.abs(flight.rollVelocity) < 0.01 && Math.abs(telemetry.rollDeg) > 10);
    check('post-roll target catches real reticle', flight.steeringError.magnitude < 1, `gap=${gap.toFixed(1)} -> ${flight.steeringError.magnitude.toFixed(2)}px`);
    check('roll does not prevent closed-loop alignment', flight.steeringError.magnitude < 1);
  }
  {
    const { flight, camera, input } = make();
    const cameraController = new CameraController();
    cameraController.snapToShip(flight, camera, DEFAULT_SETTINGS.cameraDistance);
    const t = createInitialTelemetry(ship);
    input.mouseDeltaX = 400; input.mouseDeltaY = 300;
    flight.update(dt, input, DEFAULT_SETTINGS, t, width, height, camera);
    input.mouseDeltaX = input.mouseDeltaY = 0;
    let maxOutside = 0;
    const clamp = createRoundedRectClampResult();
    const narrow = { ...DEFAULT_SETTINGS, joystickRadius: 0.65 };
    for (let i = 0; i < 120; i++) {
      flight.update(dt, input, narrow, t, width, height, camera);
      cameraController.updateChase(dt, flight, camera, narrow, t.boostIntensity, 0);
      flight.syncAimProjection(camera, t, width, height);
      clampToRoundedRect(flight.reticlePosition.x, flight.reticlePosition.y, flight.aimBoundary, clamp);
      maxOutside = Math.max(maxOutside, clamp.signedDistance);
    }
    check('boundary change constrains physical projection without jump outside', maxOutside < 0.01, `outside=${maxOutside}`);
  }
  {
    const { flight, camera, input } = make();
    const cameraController = new CameraController();
    cameraController.snapToShip(flight, camera, DEFAULT_SETTINGS.cameraDistance);
    const t = createInitialTelemetry(ship);
    const clamp = createRoundedRectClampResult();
    flight.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    cameraController.updateChase(dt, flight, camera, DEFAULT_SETTINGS, 0, 0);
    flight.syncAimProjection(camera, t, width, height);
    clampToRoundedRect(flight.reticlePosition.x, flight.reticlePosition.y, flight.aimBoundary, clamp);
    check('behind-camera aim is brought to a valid real projection', Number.isFinite(flight.reticlePosition.x) && Number.isFinite(flight.reticlePosition.y) && clamp.signedDistance < 0.01);
    let maxOutside = 0;
    input.keyYawLeft = true;
    input.rollLeft = true;
    for (let i = 0; i < 900; i++) {
      flight.update(dt, input, DEFAULT_SETTINGS, t, width, height, camera);
      cameraController.updateChase(dt, flight, camera, DEFAULT_SETTINGS, t.boostIntensity, 0);
      flight.syncAimProjection(camera, t, width, height);
      clampToRoundedRect(flight.reticlePosition.x, flight.reticlePosition.y, flight.aimBoundary, clamp);
      maxOutside = Math.max(maxOutside, clamp.signedDistance);
    }
    check('keyboard turning and roll keep physical reticle bounded', maxOutside < 0.01, `outside=${maxOutside}`);
  }
  {
    const { flight, telemetry, camera, input, step } = make();
    input.boost = true;
    for (let i = 0; i < 80; i++) step(4, -3);
    const gap = flight.steeringError.magnitude;
    input.boost = false;
    for (let i = 0; i < 900; i++) step();
    check('boost FOV change still permits closed-loop alignment', gap > 1 && flight.steeringError.magnitude < 1, `error=${flight.steeringError.magnitude.toFixed(2)}px V=(${flight.virtualMouse.x.toFixed(1)},${flight.virtualMouse.y.toFixed(1)}) T=(${flight.reticlePosition.x.toFixed(1)},${flight.reticlePosition.y.toFixed(1)}) rate=${flight.yawVelocity.toFixed(3)}/${flight.pitchVelocity.toFixed(3)} fov=${camera.fov.toFixed(1)}`);
  }
  {
    const { flight, telemetry, camera, input, step } = make();
    for (let i = 0; i < 30; i++) step(4, -3);
    flight.velocity.set(80, 20, -120);
    const combat = new CombatManager(ship.maxHull);
    combat.clearCombatState(ship.maxHull, true);
    input.mouseDeltaX = input.mouseDeltaY = 0;
    input.firePrimary = true;
    combat.update(dt, flight, input, telemetry, camera);
    const projectile = combat.projectiles.items.find(p => p.active && p.isPlayerOwned);
    const target = flight.getAimTargetPoint(new THREE.Vector3(), combat.getWeaponConfig().convergenceDistance);
    const projected = target.clone().project(camera);
    check('combat test actually fired', !!projectile);
    if (projectile) {
      const segment = target.clone().sub(projectile.position);
      const distanceToPath = segment.clone().cross(projectile.velocity.clone().normalize()).length();
      check('actual projectile velocity passes through displayed convergence point', distanceToPath < 1e-7, `miss=${distanceToPath}`);
      const forward = target.clone().sub(projectile.position).normalize();
      const expectedSpeed = Math.max(1, combat.getWeaponConfig().projectileSpeed + flight.velocity.dot(forward) * 0.3);
      check('projectile retains inherited forward velocity', Math.abs(projectile.velocity.length() - expectedSpeed) < 1e-7);
    }
    check('displayed reticle equals real convergence projection', Math.abs(telemetry.aimScreenX - (projected.x + 1) / 2) < 1e-7 && Math.abs(telemetry.aimScreenY - (1 - projected.y) / 2) < 1e-7);
  }
}
regressionScenarios();
process.exit(failures ? 1 : 0);
