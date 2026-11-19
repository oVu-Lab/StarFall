import * as THREE from 'three';
import type { GameSettings } from '../types/game';
import type { FlightController } from './FlightController';

// Pre-allocated math scratch objects
const _offsetLocal = new THREE.Vector3();
const _desiredPos = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _lookMatrix = new THREE.Matrix4();
const _desiredQuat = new THREE.Quaternion();
const _shakeVec = new THREE.Vector3();

/**
 * Third-person chase camera with smooth positional & rotational tracking,
 * subtle turn lag, dynamic boost FOV widening, and menu/hangar showcase orbits.
 */
export class CameraController {
  private readonly currentPos = new THREE.Vector3(0, 16, 52);
  private readonly currentQuat = new THREE.Quaternion();
  private readonly currentUp = new THREE.Vector3(0, 1, 0);
  private currentFov = 62;
  private initialized = false;
  private orbitTime = 0;

  public snapToShip(flight: FlightController, camera: THREE.PerspectiveCamera, distance: number): void {
    _offsetLocal.set(0, 2.35, distance).applyQuaternion(flight.quaternion);
    this.currentPos.copy(flight.position).add(_offsetLocal);

    _forward.set(0, 0, -1).applyQuaternion(flight.quaternion);
    _up.set(0, 1, 0).applyQuaternion(flight.quaternion);
    this.currentUp.copy(_up);

    _lookTarget.copy(flight.position).addScaledVector(_forward, 24).addScaledVector(_up, 0.85);
    _lookMatrix.lookAt(this.currentPos, _lookTarget, this.currentUp);
    this.currentQuat.setFromRotationMatrix(_lookMatrix);

    camera.position.copy(this.currentPos);
    camera.quaternion.copy(this.currentQuat);
    this.currentFov = 62;
    camera.fov = this.currentFov;
    camera.updateProjectionMatrix();
    this.initialized = true;
  }

  public updateChase(
    dt: number,
    flight: FlightController,
    camera: THREE.PerspectiveCamera,
    settings: GameSettings,
    boostIntensity: number,
    elapsedTime: number,
    combatImpulse = 0,
  ): void {
    const safeDt = Math.min(Math.max(dt, 0.0001), 0.05);

    if (!this.initialized) {
      this.snapToShip(flight, camera, settings.cameraDistance);
      return;
    }

    _forward.set(0, 0, -1).applyQuaternion(flight.quaternion).normalize();
    _up.set(0, 1, 0).applyQuaternion(flight.quaternion).normalize();
    _right.set(1, 0, 0).applyQuaternion(flight.quaternion).normalize();

    // Subtle outside-arc lateral & vertical chase offset so maneuvers feel natural without
    // fighting ship rotation. Strictly decoupled from mouse sensitivity.
    const camFollow = THREE.MathUtils.clamp(settings.cameraSensitivity, 0.6, 1.6);
    const lagX = THREE.MathUtils.clamp(flight.yawVelocity * 0.18, -0.55, 0.55);
    const lagY = THREE.MathUtils.clamp(-flight.pitchVelocity * 0.14, -0.4, 0.4);

    // Pull back slightly on boost to emphasize acceleration
    const dynamicDist = settings.cameraDistance + boostIntensity * 1.45;
    const heightOffset = 2.25 - boostIntensity * 0.25;

    _offsetLocal.set(lagX, heightOffset + lagY, dynamicDist).applyQuaternion(flight.quaternion);
    _desiredPos.copy(flight.position).add(_offsetLocal);

    // Crisp frame-rate-independent positional follow
    const posLambda = (15.5 + boostIntensity * 3.5) * camFollow;
    const posAlpha = 1 - Math.exp(-posLambda * safeDt);
    this.currentPos.lerp(_desiredPos, posAlpha);

    // Guardrail: never allow camera to drift far from ship during fast directional changes
    const maxAllowedDist = dynamicDist + 1.8;
    const distFromShip = this.currentPos.distanceTo(flight.position);
    if (distFromShip > maxAllowedDist) {
      this.currentPos
        .sub(flight.position)
        .multiplyScalar(maxAllowedDist / distFromShip)
        .add(flight.position);
    }

    // Crisp camera up-vector roll tracking to prevent flip during loops without sluggish lag
    const upAlpha = 1 - Math.exp(-(13.5 * camFollow) * safeDt);
    this.currentUp.lerp(_up, upAlpha);
    if (this.currentUp.lengthSq() < 0.001) {
      this.currentUp.copy(_up);
    } else {
      this.currentUp.normalize();
    }

    // Look directly ahead along ship's true forward flight vector with fast turn tracking
    _lookTarget.copy(flight.position).addScaledVector(_forward, 34).addScaledVector(_up, 0.78);

    _lookMatrix.lookAt(this.currentPos, _lookTarget, this.currentUp);
    _desiredQuat.setFromRotationMatrix(_lookMatrix);

    const angularSpeedMag = Math.hypot(flight.yawVelocity, flight.pitchVelocity);
    const rotLambda = (20.0 + angularSpeedMag * 2.2) * camFollow;
    const rotAlpha = 1 - Math.exp(-rotLambda * safeDt);
    this.currentQuat.slerp(_desiredQuat, rotAlpha);

    // Subtle high-frequency propulsion tremor during boost + brief combat impact impulse
    camera.position.copy(this.currentPos);
    const tremor = boostIntensity * 0.042 + combatImpulse * 0.14;
    if (tremor > 0.004) {
      _shakeVec
        .set(
          Math.sin(elapsedTime * 57.0) * tremor,
          Math.cos(elapsedTime * 67.0) * tremor,
          0,
        )
        .applyQuaternion(this.currentQuat);
      camera.position.add(_shakeVec);
    }

    camera.quaternion.copy(this.currentQuat);

    // Dynamic boost FOV widening
    const targetFov = 62 + boostIntensity * 16.5;
    const nextFov = THREE.MathUtils.damp(this.currentFov, targetFov, 7.0, safeDt);
    if (Math.abs(nextFov - this.currentFov) > 0.01) {
      this.currentFov = nextFov;
      camera.fov = this.currentFov;
      camera.updateProjectionMatrix();
    }
  }

  /**
   * Cinematic showcase camera used on the Main Menu and Hangar screens.
   */
  public updateShowcase(
    dt: number,
    targetPos: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    mode: 'menu' | 'hangar',
    manualYawOffset = 0,
    manualPitchOffset = 0,
  ): void {
    const safeDt = Math.min(Math.max(dt, 0.0001), 0.05);
    this.orbitTime += safeDt * (mode === 'hangar' ? 0.22 : 0.14);

    const radius = mode === 'hangar' ? 9.6 : 11.4;
    const angle = (mode === 'hangar' ? 0.7 : 0.55) + this.orbitTime + manualYawOffset;
    const elevation =
      mode === 'hangar'
        ? THREE.MathUtils.clamp(2.2 + manualPitchOffset * 4.0, -1.5, 5.2)
        : 2.8 + Math.sin(this.orbitTime * 0.7) * 0.7;

    // Offset slightly right on menu so the fighter frames beautifully beside left-aligned menu actions
    const framingOffsetX = mode === 'menu' ? -2.2 : 0;

    _desiredPos.set(
      targetPos.x + Math.sin(angle) * radius,
      targetPos.y + elevation,
      targetPos.z + Math.cos(angle) * radius,
    );

    const alpha = 1 - Math.exp(-4.5 * safeDt);
    this.currentPos.lerp(_desiredPos, alpha);

    _lookTarget.set(targetPos.x + framingOffsetX, targetPos.y + 0.25, targetPos.z);
    _lookMatrix.lookAt(this.currentPos, _lookTarget, _up.set(0, 1, 0));
    _desiredQuat.setFromRotationMatrix(_lookMatrix);
    this.currentQuat.slerp(_desiredQuat, alpha);

    camera.position.copy(this.currentPos);
    camera.quaternion.copy(this.currentQuat);

    const targetFov = mode === 'hangar' ? 46 : 52;
    const nextFov = THREE.MathUtils.damp(this.currentFov, targetFov, 5.0, safeDt);
    if (Math.abs(nextFov - this.currentFov) > 0.01) {
      this.currentFov = nextFov;
      camera.fov = this.currentFov;
      camera.updateProjectionMatrix();
    }
    this.initialized = false;
  }
}
