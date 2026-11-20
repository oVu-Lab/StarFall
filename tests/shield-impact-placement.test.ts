import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createShieldField,
  createShieldSurfaceHit,
  projectOntoShieldSurface,
} from '../src/scene/ShieldField';

/** Ship stand-in: a 2x1x4 box hull (half extents 1, 0.5, 2) wrapped in root -> bank -> model like GameScene. */
function buildRig() {
  const root = new THREE.Group();
  const bank = new THREE.Group();
  const model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), new THREE.MeshStandardMaterial()));
  bank.add(model);
  root.add(bank);
  root.updateMatrixWorld(true);
  const shield = createShieldField('#22d3ee', model);
  bank.add(shield);
  return { root, bank, shield };
}

function pose(rig: ReturnType<typeof buildRig>, pos: THREE.Vector3, quat: THREE.Quaternion, bankAngle: number) {
  rig.root.position.copy(pos);
  rig.root.quaternion.copy(quat);
  rig.bank.rotation.set(0, 0, bankAngle);
  rig.root.updateMatrixWorld(true);
}

/** Expected inflated-skin point for a probe from direction `dirLocal` along hull-local +X face, in world space. */
test('shield impact snaps onto the real hull skin under translation, rotation and bank', () => {
  const rig = buildRig();
  const inflate = rig.shield.material.uniforms.uInflate.value as number;
  assert.ok(inflate > 0, 'hull-fit skin is active');

  const poses: Array<[THREE.Vector3, THREE.Quaternion, number]> = [
    [new THREE.Vector3(0, 0, 0), new THREE.Quaternion(), 0],
    [new THREE.Vector3(120, -40, 300), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 1.9, -0.7)), 0.35],
    [new THREE.Vector3(-5, 9, 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.2, 0.3, 2.5)), -0.5],
  ];

  for (const [pos, quat, bankAngle] of poses) {
    pose(rig, pos, quat, bankAngle);
    const shipToWorld = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1))
      .multiply(new THREE.Matrix4().makeRotationZ(bankAngle));

    // A bolt arriving along ship-local -X onto the +X side: collision-sphere point is far outside the hull.
    const hitLocal = new THREE.Vector3(4.4, 0.1, 0.3);
    const dirLocal = new THREE.Vector3(-1, 0, 0);
    const hitWorld = hitLocal.clone().applyMatrix4(shipToWorld);
    const dirWorld = dirLocal.clone().transformDirection(shipToWorld);

    const out = createShieldSurfaceHit();
    assert.ok(projectOntoShieldSurface(rig.shield, hitWorld, dirWorld, out), 'projection succeeds');

    const surfaceLocal = out.surface.clone().applyMatrix4(shipToWorld.clone().invert());
    assert.ok(Math.abs(surfaceLocal.x - 1) < 1e-3, `on +X face (x=${surfaceLocal.x})`);
    assert.ok(Math.abs(surfaceLocal.y - 0.1) < 1e-3 && Math.abs(surfaceLocal.z - 0.3) < 1e-3, 'keeps lateral hit location');

    // Rendered point = base surface pushed outward along the (smoothed) skin normal by the shader inflate
    assert.ok(Math.abs(out.position.distanceTo(out.surface) - inflate) < 1e-4, 'offset equals shader inflate');
    assert.ok(out.position.clone().sub(out.surface).normalize().dot(out.normal) > 0.999, 'offset is along the normal');

    const normalLocal = out.normal.clone().transformDirection(shipToWorld.clone().invert());
    assert.ok(normalLocal.dot(new THREE.Vector3(1, 0, 0)) > 0.5, 'normal points outward from the struck side');
    assert.ok(Math.abs(out.normal.length() - 1) < 1e-4);
  }
});

test('grazing/unknown direction falls back to the radial line and still lands on the skin', () => {
  const rig = buildRig();
  pose(rig, new THREE.Vector3(10, 20, 30), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.9, 0.1)), 0.2);
  const shipToWorld = new THREE.Matrix4().compose(
    rig.root.position, rig.root.quaternion, new THREE.Vector3(1, 1, 1),
  ).multiply(new THREE.Matrix4().makeRotationZ(0.2));

  const hitWorld = new THREE.Vector3(0.2, 3.9, 0.1).applyMatrix4(shipToWorld); // above the hull top
  const out = createShieldSurfaceHit();
  assert.ok(projectOntoShieldSurface(rig.shield, hitWorld, undefined, out));
  const local = out.surface.clone().applyMatrix4(shipToWorld.clone().invert());
  assert.ok(Math.abs(local.y - 0.5) < 1e-3, `on top face (y=${local.y})`);
});
