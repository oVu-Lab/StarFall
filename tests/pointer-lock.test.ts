import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InputManager } from '../src/engine/InputManager';

test('Pointer Lock accumulates relative deltas once per frame and filters extreme spikes', () => {
  const fakeWindow = new EventTarget();
  const fakeDocument = new EventTarget() as EventTarget & { pointerLockElement: object | null };
  const canvas = { tagName: 'CANVAS' };
  fakeDocument.pointerLockElement = canvas;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
  const input = new InputManager();
  try {
    input.setLockTarget(canvas as HTMLElement);
    input.attach({});
    input.setActive(true);
    const move = (movementX: number, movementY: number, clientX: number) => {
      const event = Object.assign(new Event('mousemove'), { movementX, movementY, clientX, clientY: 0 });
      fakeWindow.dispatchEvent(event);
    };
    // Absolute position is deliberately fixed at a screen edge: only movement matters.
    move(7, -4, 0);
    move(11, -3, 0);
    move(501, 0, 0);
    let frame = input.consumeSnapshot();
    assert.equal(frame.mouseDeltaX, 18);
    assert.equal(frame.mouseDeltaY, -7);
    assert.equal(input.getDiagnostics().warpSpikesFiltered, 1);
    frame = input.consumeSnapshot();
    assert.equal(frame.mouseDeltaX, 0);
    assert.equal(frame.mouseDeltaY, 0);
    move(8, -2, 0);
    frame = input.consumeSnapshot();
    assert.equal(frame.mouseDeltaX, 8);
    assert.equal(frame.mouseDeltaY, -2);
    fakeDocument.pointerLockElement = null;
    move(5, 5, 0);
    frame = input.consumeSnapshot();
    assert.equal(frame.mouseDeltaX, 0);
    assert.equal(frame.mouseDeltaY, 0);
  } finally {
    input.detach();
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
