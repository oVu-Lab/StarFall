import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SHIP_CONFIGS } from '../src/config/ships';
import { WEAPON_CONFIGS } from '../src/config/weapons';
import { AssetManager } from '../src/engine/AssetManager';
import { createShieldField, disposeShieldField } from '../src/scene/ShieldField';
import { buildVanguardModel, VANGUARD_HARDPOINTS } from '../src/scene/vanguardModel';

test('VX-9 Vanguard hardpoints match player Twin Pulse Cannon muzzleOffsets exactly', () => {
  const expected = WEAPON_CONFIGS.player_pulse_twin.muzzleOffsets;
  assert.equal(VANGUARD_HARDPOINTS.cannonMuzzles.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.deepEqual([...VANGUARD_HARDPOINTS.cannonMuzzles[i]], expected[i]);
  }
});

test('VX-9 Vanguard geometry preserves interceptor envelope, valid normals, and tight draw-call budget', () => {
  const handle = buildVanguardModel(SHIP_CONFIGS.interceptor, 512);
  handle.group.updateMatrixWorld(true);

  const bounds = new THREE.Box3();
  let meshCount = 0;
  let totalTriangles = 0;

  handle.group.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh) return;
    meshCount += 1;
    const mat = m.material as THREE.Material;
    const pos = m.geometry.attributes.position;
    const norm = m.geometry.attributes.normal;
    assert.ok(pos && pos.count > 0, `mesh ${m.name} must have vertices`);
    assert.ok(norm && norm.count === pos.count, `mesh ${m.name} must have normals`);

    for (let i = 0; i < pos.count; i++) {
      assert.ok(Number.isFinite(pos.getX(i)), 'position X finite');
      assert.ok(Number.isFinite(pos.getY(i)), 'position Y finite');
      assert.ok(Number.isFinite(pos.getZ(i)), 'position Z finite');
      const nx = norm.getX(i);
      const ny = norm.getY(i);
      const nz = norm.getZ(i);
      assert.ok(Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz), 'normal finite');
    }

    const triCount = m.geometry.index ? m.geometry.index.count / 3 : pos.count / 3;
    totalTriangles += triCount;

    // Exclude additive exhaust plumes from hull bounding box check
    if (!Array.isArray(mat) && !mat.transparent && mat.blending !== THREE.AdditiveBlending) {
      const meshBox = new THREE.Box3().setFromObject(m);
      bounds.union(meshBox);
    }
  });

  const size = bounds.getSize(new THREE.Vector3());
  // Preserve interceptor silhouette bounds (~7.9 wingspan, ~1.5 height, ~6.4 length)
  assert.ok(size.x >= 7.2 && size.x <= 8.6, `wingspan ${size.x.toFixed(2)} within envelope`);
  assert.ok(size.y >= 1.2 && size.y <= 2.0, `height ${size.y.toFixed(2)} within envelope`);
  assert.ok(size.z >= 5.8 && size.z <= 7.0, `length ${size.z.toFixed(2)} within envelope`);

  // Verify symmetry around X = 0
  const center = bounds.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(center.x) < 0.02, `hull horizontally symmetric (center.x=${center.x.toFixed(4)})`);

  // Verify draw-call consolidation & real-time triangle budget
  assert.ok(meshCount <= 22, `draw calls tightly consolidated (got ${meshCount})`);
  assert.ok(totalTriangles >= 2000 && totalTriangles <= 30000, `triangle count ${totalTriangles} in target range`);

  // Verify tight hull-hugging ShieldField fits without falling back to loose ellipsoid
  const shield = createShieldField('#22d3ee', handle.group);
  assert.ok(shield.material.uniforms.uInflate.value > 0, 'ShieldField fitted directly to hull geometry');
  disposeShieldField(shield);

  // Verify animation & LOD callbacks execute cleanly
  handle.updateVisuals(0.016, 0.8, 0.9, 0.2, -0.35, 0.5);
  handle.setDetailLevel?.(false);
  handle.setDetailLevel?.(true);

  handle.dispose();
  assert.equal(AssetManager.getDiagnostics().totalRefs, 0, 'all AssetManager refs released on dispose');
});
