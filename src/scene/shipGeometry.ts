import * as THREE from 'three';
import { AssetManager } from '../engine/AssetManager';
import type { ShipConfig, ShipVisualHandle } from '../types/game';

const EXHAUST_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const EXHAUST_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uCoreColor;
  uniform vec3 uOuterColor;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    // vUv.y = 1.0 near engine nozzle, 0.0 at trailing plume tip
    float axial = clamp(vUv.y, 0.0, 1.0);
    float edgeSoft = pow(abs(dot(vNormalView, vViewDir)), 0.75);

    // Animated shock-diamond plasma bands moving aft
    float pulse = 0.82 + 0.18 * sin(axial * 18.0 + uTime * 36.0);
    float coreMask = smoothstep(0.32, 0.95, axial) * edgeSoft;

    vec3 col = mix(uOuterColor, uCoreColor, coreMask * (0.65 + 0.35 * uIntensity));
    float alpha = pow(axial, 1.45) * edgeSoft * pulse * (0.45 + 0.55 * uIntensity);
    gl_FragColor = vec4(col * (1.2 + uIntensity * 0.9), alpha);
  }
`;

function createExtrudedWing(
  points: Array<[number, number]>,
  depth: number,
  bevelSize = 0.04,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevelSize,
    bevelSize,
    bevelSegments: 2,
  });
  geo.center();
  return geo;
}

/**
 * Builds a multi-part high-craft procedural 3D space fighter for the given ShipConfig.
 * Forward direction is strictly -Z, up is +Y, right is +X.
 */
export function buildShipModel(
  ship: ShipConfig,
  textureResolution: 256 | 512 | 1024 = 512,
): ShipVisualHandle {
  const hullRes = AssetManager.acquireHullTextures(textureResolution);
  const textures = hullRes.bundle;
  const glowSpriteTex = AssetManager.acquireGlowSprite();
  const root = new THREE.Group();
  root.name = `ship-${ship.id}`;

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  // Calibrated PBR materials with clear roughness/metalness contrast between adjacent assemblies
  const hullPrimaryMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(ship.colors.hullPrimary).lerp(new THREE.Color('#94a3b8'), 0.45),
      map: textures.hullAlbedo,
      roughnessMap: textures.hullRoughness,
      bumpMap: textures.hullBump,
      bumpScale: 0.028,
      metalness: 0.78,
      roughness: 0.34,
      envMapIntensity: 1.35,
    }),
  );

  const hullDarkMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(ship.colors.hullSecondary).lerp(new THREE.Color('#334155'), 0.4),
      roughnessMap: textures.hullRoughness,
      metalness: 0.55,
      roughness: 0.62,
      envMapIntensity: 1.1,
    }),
  );

  const hullMetallicAccentMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      metalness: 0.92,
      roughness: 0.22,
      envMapIntensity: 1.5,
    }),
  );

  const cyanTrimMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: ship.colors.hullTrim,
      emissive: new THREE.Color(ship.colors.hullTrim),
      emissiveIntensity: 1.35,
      metalness: 0.3,
      roughness: 0.2,
      toneMapped: false,
    }),
  );

  const canopyMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: ship.colors.canopy,
      metalness: 0.12,
      roughness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      reflectivity: 1.0,
      envMapIntensity: 1.85,
    }),
  );

  const engineCoreMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: ship.colors.engineCore,
      emissive: new THREE.Color(ship.colors.engineGlow),
      emissiveIntensity: 2.2,
      roughness: 0.15,
      metalness: 0.1,
      toneMapped: false,
    }),
  );

  const exhaustMat = trackMat(
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.35 },
        uCoreColor: { value: new THREE.Color(ship.colors.engineCore) },
        uOuterColor: { value: new THREE.Color(ship.colors.engineGlow) },
      },
      vertexShader: EXHAUST_VERTEX,
      fragmentShader: EXHAUST_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );

  const glowSpriteMat = trackMat(
    new THREE.SpriteMaterial({
      map: glowSpriteTex,
      color: new THREE.Color(ship.colors.engineGlow),
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );

  const exhaustMeshes: THREE.Mesh[] = [];
  const glowSprites: THREE.Sprite[] = [];
  const thrusterOffsets: Array<[number, number, number, number]> = [];

  // Shared geometry helpers per class so Interceptor, Striker, and Destroyer have unmistakable silhouettes
  const isDestroyer = ship.id === 'destroyer';
  const isStriker = ship.id === 'striker';

  const fuselageLength = isDestroyer ? 6.6 : isStriker ? 6.1 : 6.4;
  const fuselageWidth = isDestroyer ? 1.85 : isStriker ? 1.45 : 1.18;
  const fuselageHeight = isDestroyer ? 0.92 : isStriker ? 0.72 : 0.62;

  // 1. Primary sculpted fuselage spine (tapered needle nose toward -Z)
  const noseGeo = trackGeo(new THREE.ConeGeometry(fuselageWidth * 0.52, fuselageLength * 0.56, 6));
  noseGeo.rotateX(-Math.PI / 2);
  noseGeo.scale(1.0, fuselageHeight / fuselageWidth, 1.0);
  const noseMesh = new THREE.Mesh(noseGeo, hullPrimaryMat);
  noseMesh.position.set(0, 0, -fuselageLength * 0.34);
  noseMesh.castShadow = true;
  noseMesh.receiveShadow = true;
  root.add(noseMesh);

  // Mid & rear fuselage core block (beveled hexagonal prism)
  const bodyGeo = trackGeo(new THREE.CylinderGeometry(fuselageWidth * 0.52, fuselageWidth * 0.62, fuselageLength * 0.52, 6));
  bodyGeo.rotateX(-Math.PI / 2);
  bodyGeo.scale(1.0, fuselageHeight / fuselageWidth, 1.0);
  const bodyMesh = new THREE.Mesh(bodyGeo, hullPrimaryMat);
  bodyMesh.position.set(0, 0, fuselageLength * 0.16);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  root.add(bodyMesh);

  // Upper dorsal armored spine ridge
  const spineGeo = trackGeo(
    createExtrudedWing(
      [
        [0, -1.8],
        [fuselageWidth * 0.28, -0.4],
        [fuselageWidth * 0.34, 1.75],
        [-fuselageWidth * 0.34, 1.75],
        [-fuselageWidth * 0.28, -0.4],
      ],
      0.22,
      0.035,
    ),
  );
  spineGeo.rotateX(Math.PI / 2);
  const spineMesh = new THREE.Mesh(spineGeo, hullDarkMat);
  spineMesh.position.set(0, fuselageHeight * 0.42, 0.35);
  root.add(spineMesh);

  // Ventral keel & intake scoop
  const keelGeo = trackGeo(new THREE.BoxGeometry(fuselageWidth * 0.54, fuselageHeight * 0.32, fuselageLength * 0.46));
  const keelMesh = new THREE.Mesh(keelGeo, hullDarkMat);
  keelMesh.position.set(0, -fuselageHeight * 0.42, 0.2);
  root.add(keelMesh);

  // 2. Sculpted armored cockpit canopy + internal cyan instrument strip
  const canopyGeo = trackGeo(new THREE.SphereGeometry(fuselageWidth * 0.36, 20, 14));
  canopyGeo.scale(0.86, 0.56, 2.35);
  const canopyMesh = new THREE.Mesh(canopyGeo, canopyMat);
  canopyMesh.position.set(0, fuselageHeight * 0.44, -0.82);
  root.add(canopyMesh);

  const canopyFrameGeo = trackGeo(new THREE.TorusGeometry(fuselageWidth * 0.32, 0.035, 8, 16, Math.PI));
  canopyFrameGeo.scale(0.9, 0.65, 1);
  const canopyFrame = new THREE.Mesh(canopyFrameGeo, hullMetallicAccentMat);
  canopyFrame.position.set(0, fuselageHeight * 0.42, -0.95);
  root.add(canopyFrame);

  // Subtle glowing cockpit HUD bar inside nose
  const cockpitGlowGeo = trackGeo(new THREE.BoxGeometry(fuselageWidth * 0.36, 0.045, 0.14));
  const cockpitGlow = new THREE.Mesh(cockpitGlowGeo, cyanTrimMat);
  cockpitGlow.position.set(0, fuselageHeight * 0.54, -1.45);
  root.add(cockpitGlow);

  // 3. Asymmetric-profile beveled primary wings (mirrored L/R)
  const wingPoints: Array<[number, number]> = isDestroyer
    ? [
        [0.0, -1.4],
        [3.1, -0.2],
        [3.4, 1.3],
        [2.2, 2.05],
        [0.0, 1.85],
      ]
    : isStriker
      ? [
          [0.0, -0.95],
          [3.6, -1.35],
          [3.2, 0.4],
          [1.6, 1.7],
          [0.0, 1.55],
        ]
      : [
          // Sleek swept delta Interceptor wings
          [0.0, -1.65],
          [3.75, 0.85],
          [3.55, 1.68],
          [1.55, 1.45],
          [0.0, 1.82],
        ];

  const leftWingGeo = trackGeo(createExtrudedWing(wingPoints, 0.11, 0.03));
  leftWingGeo.rotateX(Math.PI / 2);

  for (const side of [-1, 1] as const) {
    const wingHolder = new THREE.Group();
    const wingMesh = new THREE.Mesh(leftWingGeo, hullPrimaryMat);
    wingMesh.scale.x = side;
    wingMesh.position.set(side * (fuselageWidth * 0.48 + 1.45), -0.04, 0.65);
    wingMesh.rotation.z = side * (isDestroyer ? -0.05 : -0.08);
    wingMesh.castShadow = true;
    wingMesh.receiveShadow = true;
    wingHolder.add(wingMesh);

    // Wing armored shoulder strake
    const strakeGeo = trackGeo(new THREE.BoxGeometry(0.42, 0.24, 2.35));
    const strake = new THREE.Mesh(strakeGeo, hullDarkMat);
    strake.position.set(side * (fuselageWidth * 0.65), 0.06, 0.52);
    strake.rotation.z = side * -0.18;
    wingHolder.add(strake);

    // Glowing cyan wing leading-edge accent strip
    const trimGeo = trackGeo(new THREE.BoxGeometry(1.75, 0.045, 0.08));
    const trim = new THREE.Mesh(trimGeo, cyanTrimMat);
    trim.position.set(side * (fuselageWidth * 0.55 + 1.15), 0.03, isStriker ? -0.32 : 0.45);
    trim.rotation.y = side * (isStriker ? 0.12 : -0.44);
    trim.rotation.z = side * -0.08;
    wingHolder.add(trim);

    // Forward wing-mounted cannon pods (visual readiness for Phase 2 combat)
    const cannonPodGeo = trackGeo(new THREE.CylinderGeometry(0.085, 0.11, 1.65, 10));
    cannonPodGeo.rotateX(Math.PI / 2);
    const cannonPod = new THREE.Mesh(cannonPodGeo, hullMetallicAccentMat);
    cannonPod.position.set(side * (fuselageWidth * 0.6 + 0.88), -0.14, -0.65);
    wingHolder.add(cannonPod);

    const barrelTipGeo = trackGeo(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 8));
    barrelTipGeo.rotateX(Math.PI / 2);
    const barrelTip = new THREE.Mesh(barrelTipGeo, cyanTrimMat);
    barrelTip.position.set(side * (fuselageWidth * 0.6 + 0.88), -0.14, -1.52);
    wingHolder.add(barrelTip);

    // Canted twin vertical tail stabilizers
    const finGeo = trackGeo(
      createExtrudedWing(
        [
          [0, 0],
          [0.95, 1.15],
          [1.45, 1.1],
          [1.25, 0],
        ],
        0.075,
        0.02,
      ),
    );
    finGeo.rotateY(Math.PI / 2);
    const fin = new THREE.Mesh(finGeo, hullDarkMat);
    fin.position.set(side * (fuselageWidth * 0.56 + 0.25), 0.58, 1.65);
    fin.rotation.z = side * -0.32;
    wingHolder.add(fin);

    // Wingtip navigation beacon
    const navTipGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.06, 0.52));
    const navTip = new THREE.Mesh(navTipGeo, cyanTrimMat);
    navTip.position.set(
      side * (isDestroyer ? 3.55 : isStriker ? 3.85 : 3.95),
      -0.18,
      isStriker ? -0.35 : 1.38,
    );
    wingHolder.add(navTip);

    root.add(wingHolder);
  }

  // Forward canard winglets for Interceptor agility silhouette
  if (!isDestroyer) {
    const canardGeo = trackGeo(
      createExtrudedWing(
        [
          [0, -0.35],
          [0.95, 0.15],
          [0.82, 0.42],
          [0, 0.28],
        ],
        0.05,
        0.015,
      ),
    );
    canardGeo.rotateX(Math.PI / 2);
    for (const side of [-1, 1] as const) {
      const canard = new THREE.Mesh(canardGeo, hullPrimaryMat);
      canard.scale.x = side;
      canard.position.set(side * (fuselageWidth * 0.42 + 0.38), -0.02, -1.55);
      canard.rotation.z = side * 0.12;
      root.add(canard);
    }
  }

  // 4. Engine Nacelles, Thruster Nozzles, Glowing Cores & Volumetric Exhaust Plumes
  if (isDestroyer) {
    thrusterOffsets.push([-0.82, 0.02, 2.55, 0.46]);
    thrusterOffsets.push([0, 0.14, 2.65, 0.52]);
    thrusterOffsets.push([0.82, 0.02, 2.55, 0.46]);
  } else if (isStriker) {
    thrusterOffsets.push([-0.68, 0.02, 2.38, 0.4]);
    thrusterOffsets.push([0.68, 0.02, 2.38, 0.4]);
  } else {
    thrusterOffsets.push([-0.52, 0.02, 2.42, 0.36]);
    thrusterOffsets.push([0.52, 0.02, 2.42, 0.36]);
  }

  const nozzleGeo = trackGeo(new THREE.CylinderGeometry(0.95, 1.15, 0.85, 16, 1, true));
  nozzleGeo.rotateX(Math.PI / 2);

  const ringGeo = trackGeo(new THREE.TorusGeometry(0.88, 0.09, 10, 20));
  const coreDiscGeo = trackGeo(new THREE.CircleGeometry(0.76, 18));

  // Tapered open cone pointing aft (+Z) for plasma exhaust plume
  const plumeGeo = trackGeo(new THREE.ConeGeometry(0.74, 3.6, 18, 1, true));
  plumeGeo.rotateX(Math.PI / 2);
  plumeGeo.translate(0, 0, 1.8);

  for (const [tx, ty, tz, radius] of thrusterOffsets) {
    const engineUnit = new THREE.Group();
    engineUnit.position.set(tx, ty, tz);

    const shroud = new THREE.Mesh(nozzleGeo, hullMetallicAccentMat);
    shroud.scale.set(radius, radius, 1);
    engineUnit.add(shroud);

    const glowRing = new THREE.Mesh(ringGeo, cyanTrimMat);
    glowRing.scale.setScalar(radius);
    glowRing.position.z = 0.38;
    engineUnit.add(glowRing);

    const coreDisc = new THREE.Mesh(coreDiscGeo, engineCoreMat);
    coreDisc.scale.setScalar(radius);
    coreDisc.position.z = 0.24;
    engineUnit.add(coreDisc);

    const plume = new THREE.Mesh(plumeGeo, exhaustMat);
    plume.scale.set(radius * 1.12, radius * 1.12, 0.9);
    plume.position.z = 0.3;
    plume.renderOrder = 10;
    engineUnit.add(plume);
    exhaustMeshes.push(plume);

    const sprite = new THREE.Sprite(glowSpriteMat);
    sprite.position.set(0, 0, 0.55);
    sprite.scale.setScalar(radius * 3.8);
    sprite.renderOrder = 11;
    engineUnit.add(sprite);
    glowSprites.push(sprite);

    root.add(engineUnit);
  }

  // Rear engine point light casting cyan bounce illumination onto stabilizers
  const engineLight = new THREE.PointLight(ship.colors.engineGlow, 3.2, 16, 1.8);
  engineLight.position.set(0, 0.2, 3.3);
  root.add(engineLight);

  let animTime = 0;
  let highDetailEnabled = true;

  return {
    group: root,
    setDetailLevel: (highDetail: boolean) => {
      if (highDetailEnabled === highDetail) return;
      highDetailEnabled = highDetail;
      engineLight.visible = highDetail;
      for (let i = 0; i < glowSprites.length; i++) {
        glowSprites[i].visible = highDetail;
      }
    },
    updateVisuals: (dt, speedRatio, boostIntensity, _yawInput, _pitchInput, _rollInput) => {
      animTime += dt;
      const clampedSpeed = THREE.MathUtils.clamp(speedRatio, 0, 1.6);
      const intensity = THREE.MathUtils.clamp(0.28 + clampedSpeed * 0.45 + boostIntensity * 0.85, 0.2, 1.6);

      exhaustMat.uniforms.uTime.value = animTime;
      exhaustMat.uniforms.uIntensity.value = intensity;

      engineCoreMat.emissiveIntensity = 1.8 + clampedSpeed * 0.9 + boostIntensity * 2.4;
      cyanTrimMat.emissiveIntensity = 1.15 + boostIntensity * 1.45;
      if (highDetailEnabled) {
        engineLight.intensity = 2.4 + clampedSpeed * 1.6 + boostIntensity * 5.2;
      }

      const plumeLen = 0.55 + clampedSpeed * 0.62 + boostIntensity * 1.35 + Math.sin(animTime * 42) * 0.05;
      const plumeRad = 1.0 + boostIntensity * 0.32;

      for (let i = 0; i < exhaustMeshes.length; i++) {
        const baseRadius = thrusterOffsets[i][3];
        exhaustMeshes[i].scale.set(
          baseRadius * 1.12 * plumeRad,
          baseRadius * 1.12 * plumeRad,
          plumeLen,
        );
      }

      if (highDetailEnabled) {
        const spriteScale = 3.5 + clampedSpeed * 1.3 + boostIntensity * 3.2;
        glowSpriteMat.opacity = THREE.MathUtils.clamp(0.45 + boostIntensity * 0.5, 0.4, 0.96);
        for (let i = 0; i < glowSprites.length; i++) {
          const baseRadius = thrusterOffsets[i][3];
          glowSprites[i].scale.setScalar(baseRadius * spriteScale);
        }
      }
    },
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      AssetManager.releaseHullTextures(hullRes.key);
      AssetManager.releaseGlowSprite();
    },
  };
}
