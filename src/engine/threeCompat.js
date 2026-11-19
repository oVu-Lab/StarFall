export * from 'three-real';
import { Timer } from 'three-real';

/**
 * Drop-in THREE.Clock replacement backed by THREE.Timer (Three.js r183+).
 * Used via Vite alias so @react-three/fiber's internal `new THREE.Clock()` runs on
 * THREE.Timer instead of instantiating the deprecated THREE.Clock module.
 */
export class Clock {
  constructor(autoStart = true) {
    this.autoStart = autoStart;
    this.startTime = 0;
    this.oldTime = 0;
    this.elapsedTime = 0;
    this.running = false;
    this._timer = new Timer();
  }

  start() {
    this._timer.reset();
    if (typeof document !== 'undefined') {
      this._timer.connect(document);
    }
    const now = performance.now();
    this.startTime = now;
    this.oldTime = now;
    this.elapsedTime = 0;
    this.running = true;
  }

  stop() {
    this.getElapsedTime();
    this._timer.disconnect();
    this.running = false;
    this.autoStart = false;
  }

  getElapsedTime() {
    this.getDelta();
    return this.elapsedTime;
  }

  getDelta() {
    if (this.autoStart && !this.running) {
      this.start();
      return 0;
    }

    if (this.running) {
      this._timer.update();
      const diff = this._timer.getDelta();
      this.oldTime = performance.now();
      this.elapsedTime += diff;
      return diff;
    }

    return 0;
  }
}
