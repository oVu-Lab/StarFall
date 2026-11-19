// Projection-aware regression coverage for STARFALL mouse-to-reticle alignment.
// Run: node_modules/.bin/tsx tests/alignment.test.ts
import * as THREE from 'three';
import { CameraController } from '../src/engine/CameraController';
import { FlightController, createInitialTelemetry } from '../src/engine/FlightController';
import { MOUSE_ALIGNMENT_CONFIG as MA } from '../src/config/steering';
import { DEFAULT_SETTINGS, SHIP_CONFIGS } from '../src/config/ships';
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
  for (let i = 0; i < 80; i += 1) step(horizontal ? 5 : 0, horizontal ? 0 : 5);
  check(`[${axis}] virtual mouse exceeds boundary by 200px`, Math.abs(virtualAxis()) > halfBoundary() + 190, `V=${virtualAxis().toFixed(1)} half=${halfBoundary().toFixed(1)}`);
  check(`[${axis}] projected reticle is bounded`, Math.abs(reticleAxis()) <= halfBoundary() + 0.01, `R=${reticleAxis().toFixed(1)} half=${halfBoundary().toFixed(1)}`);
  check(`[${axis}] alignment demand exists beyond boundary`, Math.abs(turnRate()) > 0.04, `rate=${turnRate().toFixed(3)} rad/s`);

  // D/E/F: stop physical mouse. V must remain static while actual rotation changes projected R.
  const virtualBefore = { ...flight.virtualMouse };
  const errorBefore = flight.steeringError.magnitude;
  const reticleBefore = reticleAxis();
  let turn = 0;
  let sawReticleMove = false;
  for (let i = 0; i < 50; i += 1) {
    step(0, 0);
    turn += (horizontal ? flight.yawVelocity : flight.pitchVelocity) * dt;
    if (Math.abs(reticleAxis() - reticleBefore) > 0.01) sawReticleMove = true;
  }
  check(`[${axis}] continues turning after mouse stop`, Math.abs(turn) > 0.015, `turn=${THREE.MathUtils.radToDeg(turn).toFixed(1)}°`);
  check(`[${axis}] rotation never changes V`, flight.virtualMouse.x === virtualBefore.x && flight.virtualMouse.y === virtualBefore.y);
  check(`[${axis}] reticle motion comes from actual rotation`, sawReticleMove);
  check(`[${axis}] alignment error decreases`, flight.steeringError.magnitude < errorBefore, `${errorBefore.toFixed(1)} -> ${flight.steeringError.magnitude.toFixed(1)} px`);

  // G/H: firing direction and HUD location are an identical camera projection.
  const aimPoint = flight.getAimTargetPoint(new THREE.Vector3(), MA.projectionDistance).project(camera);
  const aimX = (aimPoint.x + 1) * 0.5;
  const aimY = (1 - aimPoint.y) * 0.5;
  check(
    `[${axis}] firing ray matches displayed reticle`,
    Math.abs(aimX - telemetry.aimScreenX) < 0.002 && Math.abs(aimY - telemetry.aimScreenY) < 0.002,
    `ray=(${aimX.toFixed(4)},${aimY.toFixed(4)}) hud=(${telemetry.aimScreenX.toFixed(4)},${telemetry.aimScreenY.toFixed(4)})`,
  );

  // F: with no further physical movement, the bounded target and physical cannon ray converge
  // and the demand settles naturally instead of requiring a cursor reset.
  for (let i = 0; i < 600; i += 1) step(0, 0);
  check(`[${axis}] reaches alignment without input`, flight.steeringError.magnitude < 2, `error=${flight.steeringError.magnitude.toFixed(2)} px`);
  check(`[${axis}] steering settles at alignment`, Math.abs(turnRate()) < 0.02, `rate=${turnRate().toFixed(4)} rad/s`);

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
  for (let i = 0; i < 84; i += 1) step(5, -4);
  const finiteTelemetry = [
    telemetry.aimScreenX, telemetry.aimScreenY,
    telemetry.virtualMouseScreenX, telemetry.virtualMouseScreenY,
    telemetry.alignmentErrorPx,
  ].every(Number.isFinite);
  check('large diagonal command keeps both markers finite', finiteTelemetry);
  check('large diagonal command yields both angular rates', Math.abs(flight.yawVelocity) > 0.03 && Math.abs(flight.pitchVelocity) > 0.03);
}

runAxis('yaw');
runAxis('pitch');
runCombinedAxes();
process.exit(failures ? 1 : 0);
