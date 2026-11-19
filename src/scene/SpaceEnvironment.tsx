import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GraphicsPreset } from '../config/graphics';
import { AssetManager } from '../engine/AssetManager';
import type { MissionEnvironmentTheme } from '../types/mission';

const NEBULA_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NEBULA_FRAGMENT = /* glsl */ `
  varying vec3 vDir;
  uniform float uTime;
  uniform int uOctaves;
  uniform vec3 uVoidCol;
  uniform vec3 uMidCol;
  uniform vec3 uIonCol;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(
        mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x),
        f.y
      ),
      mix(
        mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x),
        f.y
      ),
      f.z
    );
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.52;
    for (int i = 0; i < 5; i++) {
      if (i >= uOctaves) break;
      v += a * noise(p);
      p = p * 2.04 + vec3(13.1, 7.7, 5.3);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);

    // Galactic plane tilted softly across the sky
    float plane = exp(-abs(d.y * 2.4 + d.x * 0.65) * 2.2);

    float n1 = fbm(d * 2.6 + vec3(0.0, uTime * 0.004, 0.0));
    float n2 = fbm(d * 5.2 - vec3(uTime * 0.003, 1.2, 2.5));
    float filament = smoothstep(0.42, 0.86, n1 * 0.72 + n2 * 0.38);

    vec3 indigoDust = uMidCol * vec3(1.4, 0.85, 1.15);

    vec3 col = uVoidCol;
    col = mix(col, uMidCol, smoothstep(0.28, 0.75, n1) * (0.45 + 0.55 * plane));
    col += indigoDust * smoothstep(0.5, 0.9, n2) * 0.36 * plane;
    col += uIonCol * filament * plane * 0.44;

    // Distant blue-white sun corona glow on upper-right horizon
    vec3 sunDir = normalize(vec3(0.58, 0.32, -0.74));
    float sunDot = max(dot(d, sunDir), 0.0);
    col += vec3(0.42, 0.78, 1.0) * pow(sunDot, 16.0) * 0.36;
    col += vec3(0.95, 0.98, 1.0) * pow(sunDot, 220.0) * 1.1;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vNormalWorld;
  varying vec3 vViewDir;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalWorld = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  varying vec3 vNormalWorld;
  varying vec3 vViewDir;
  uniform vec3 uColor;

  void main() {
    float rim = 1.0 - max(dot(vNormalWorld, vViewDir), 0.0);
    float glow = pow(rim, 3.2);
    gl_FragColor = vec4(uColor * 1.35, glow * 0.78);
  }
`;

const RING_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RING_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uInnerCol;
  uniform vec3 uOuterCol;

  void main() {
    vec2 centered = vUv * 2.0 - 1.0;
    float r = length(centered);
    if (r < 0.46 || r > 0.98) discard;

    float t = (r - 0.46) / 0.52;
    float bands = 0.55 + 0.45 * sin(t * 58.0) * cos(t * 21.0 + 0.6);
    float cassiniGap = 1.0 - smoothstep(0.61, 0.64, t) * (1.0 - smoothstep(0.68, 0.71, t));
    float edgeFade = smoothstep(0.0, 0.09, t) * (1.0 - smoothstep(0.88, 1.0, t));

    vec3 col = mix(uInnerCol, uOuterCol, t);
    float alpha = bands * cassiniGap * edgeFade * 0.58;
    gl_FragColor = vec4(col, alpha);
  }
`;

const STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  varying vec3 vColor;
  varying float vTwinkle;
  uniform float uTime;

  void main() {
    vColor = color;
    vTwinkle = 0.74 + 0.26 * sin(uTime * 1.8 + aPhase);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * (340.0 / max(-mvPosition.z, 1.0)), 1.2, 6.5);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float core = pow(1.0 - d, 2.2);
    gl_FragColor = vec4(vColor * (1.15 * vTwinkle), core);
  }
`;

interface SpaceEnvironmentProps {
  graphics: GraphicsPreset;
  theme: MissionEnvironmentTheme;
}

const _dummy = new THREE.Object3D();

export function SpaceEnvironment({ graphics, theme }: SpaceEnvironmentProps) {
  const { gl, scene, camera } = useThree();
  const skyboxRef = useRef<THREE.Mesh>(null);
  const starGroupRef = useRef<THREE.Points>(null);
  const gasGiantRef = useRef<THREE.Group>(null);
  const moonRef = useRef<THREE.Mesh>(null);
  const asteroidsRef = useRef<THREE.InstancedMesh>(null);

  // Configure procedural studio RoomEnvironment IBL so metallic PBR ships catch realistic reflections
  useEffect(() => {
    AssetManager.configureRenderer(gl);
    const pmrem = new THREE.PMREMGenerator(gl);
    const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    scene.background = new THREE.Color('#030712');

    return () => {
      scene.environment = null;
      envTarget.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  // Sync mission-specific atmospheric fog color
  useEffect(() => {
    scene.fog = new THREE.FogExp2(theme.fogColor, 0.00028);
  }, [scene, theme.fogColor]);

  // Stage C/D/E reference-counted mission environment textures
  const envTex = useMemo(
    () => AssetManager.acquireEnvironmentTextures(theme, graphics.textureResolution),
    [theme, graphics.textureResolution],
  );

  useEffect(() => {
    return () => {
      AssetManager.releaseEnvironmentTextures(envTex.key);
    };
  }, [envTex.key]);

  // Nebula skybox shader material with adaptive FBM octaves & mission palette
  const nebulaMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uOctaves: { value: graphics.nebulaOctaves },
          uVoidCol: { value: new THREE.Vector3(...theme.nebulaVoid) },
          uMidCol: { value: new THREE.Vector3(...theme.nebulaMid) },
          uIonCol: { value: new THREE.Vector3(...theme.nebulaIon) },
        },
        vertexShader: NEBULA_VERTEX,
        fragmentShader: NEBULA_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    nebulaMat.uniforms.uOctaves.value = graphics.nebulaOctaves;
    nebulaMat.uniforms.uVoidCol.value.set(...theme.nebulaVoid);
    nebulaMat.uniforms.uMidCol.value.set(...theme.nebulaMid);
    nebulaMat.uniforms.uIonCol.value.set(...theme.nebulaIon);
  }, [nebulaMat, graphics.nebulaOctaves, theme]);

  // Planet atmosphere & ring shaders
  const atmosphereMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(theme.atmosphereColor) } },
        vertexShader: ATMOSPHERE_VERTEX,
        fragmentShader: ATMOSPHERE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    atmosphereMat.uniforms.uColor.value.set(theme.atmosphereColor);
  }, [atmosphereMat, theme.atmosphereColor]);

  const ringMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uInnerCol: { value: new THREE.Color(theme.atmosphereColor).lerp(new THREE.Color('#94a3b8'), 0.4) },
          uOuterCol: { value: new THREE.Color(theme.planetBands[1]) },
        },
        vertexShader: RING_VERTEX,
        fragmentShader: RING_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    ringMat.uniforms.uInnerCol.value
      .set(theme.atmosphereColor)
      .lerp(new THREE.Color('#94a3b8'), 0.4);
    ringMat.uniforms.uOuterCol.value.set(theme.planetBands[1]);
  }, [ringMat, theme]);

  // Procedural multi-spectral starfield
  const { starGeo, starMat } = useMemo(() => {
    const count = graphics.starCount;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const palette = [
      new THREE.Color('#e0f2fe'),
      new THREE.Color('#bae6fd'),
      new THREE.Color('#f8fafc'),
      new THREE.Color('#93c5fd'),
      new THREE.Color('#fef3c7'),
    ];

    let seed = 42019;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < count; i++) {
      const u = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const sqrtOneMinusU2 = Math.sqrt(Math.max(0, 1 - u * u));
      const radius = 1400 + rand() * 1400;

      positions[i * 3] = radius * sqrtOneMinusU2 * Math.cos(theta);
      positions[i * 3 + 1] = radius * u;
      positions[i * 3 + 2] = radius * sqrtOneMinusU2 * Math.sin(theta);

      const col = palette[Math.floor(rand() * palette.length)];
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;

      sizes[i] = 1.4 + Math.pow(rand(), 3.2) * 5.2;
      phases[i] = rand() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    return { starGeo: geo, starMat: mat };
  }, [graphics.starCount]);

  // Sculpted procedural asteroid geometry for InstancedMesh orbital belt
  const asteroidGeo = useMemo(() => {
    const geo = new THREE.DodecahedronGeometry(1, graphics.environmentDetail === 'low' ? 0 : 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const disp =
        0.82 +
        0.18 * Math.sin(x * 3.7 + y * 2.1) +
        0.14 * Math.cos(z * 4.3 - x * 2.9);
      pos.setXYZ(i, x * disp, y * disp * 0.86, z * disp);
    }
    geo.computeVertexNormals();
    return geo;
  }, [graphics.environmentDetail]);

  const asteroidMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: envTex.bundle.asteroidMap,
        color: theme.asteroidTint,
        roughness: 0.88,
        metalness: 0.14,
      }),
    [envTex.bundle.asteroidMap, theme.asteroidTint],
  );

  // Orbital sector beacons for crisp visual scale & spatial orientation
  const beacons = useMemo(() => {
    return [
      { pos: [0, 8, -140] as [number, number, number], scale: 1.0 },
      { pos: [145, 28, -320] as [number, number, number], scale: 1.2 },
      { pos: [-170, -18, -460] as [number, number, number], scale: 1.15 },
      { pos: [70, 52, -720] as [number, number, number], scale: 1.3 },
      { pos: [-240, 14, -180] as [number, number, number], scale: 1.0 },
      { pos: [280, -34, -110] as [number, number, number], scale: 1.1 },
    ];
  }, []);

  // Populate instanced asteroid field with deterministic layout leaving clear flight corridor around spawn
  useEffect(() => {
    const mesh = asteroidsRef.current;
    if (!mesh) return;

    let seed = 88123;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const tint = new THREE.Color();

    for (let i = 0; i < graphics.asteroidCount; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = 75 + rand() * 820;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist - 220;
      const y = (rand() - 0.5) * 260;

      if (Math.hypot(x, y - 12, z - 40) < 62) {
        _dummy.position.set(x + 95, y + 35, z - 85);
      } else {
        _dummy.position.set(x, y, z);
      }

      const scale = 1.6 + Math.pow(rand(), 2.2) * 16.5;
      _dummy.scale.set(
        scale * (0.85 + rand() * 0.35),
        scale * (0.75 + rand() * 0.35),
        scale * (0.85 + rand() * 0.35),
      );
      _dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);

      const luma = 0.42 + rand() * 0.32;
      tint.setRGB(luma * 0.88, luma * 0.94, luma * 1.06);
      mesh.setColorAt(i, tint);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [graphics.asteroidCount, theme.id]);

  useEffect(() => {
    return () => {
      starGeo.dispose();
      starMat.dispose();
    };
  }, [starGeo, starMat]);

  useEffect(() => {
    return () => {
      asteroidGeo.dispose();
      asteroidMat.dispose();
    };
  }, [asteroidGeo, asteroidMat]);

  useEffect(() => {
    return () => {
      nebulaMat.dispose();
      atmosphereMat.dispose();
      ringMat.dispose();
    };
  }, [nebulaMat, atmosphereMat, ringMat]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;
    nebulaMat.uniforms.uTime.value = t;
    starMat.uniforms.uTime.value = t;

    if (skyboxRef.current) {
      skyboxRef.current.position.copy(camera.position);
    }
    if (starGroupRef.current) {
      starGroupRef.current.position.copy(camera.position);
    }
    if (gasGiantRef.current) {
      gasGiantRef.current.rotation.y += dt * 0.008;
    }
    if (moonRef.current) {
      moonRef.current.rotation.y += dt * 0.016;
    }
  });

  return (
    <group name="space-environment">
      {/* Solar Key Light + Deep-Space Fill + Mission-Themed Rim Backlight */}
      <directionalLight
        position={[320, 190, -260]}
        intensity={2.6}
        color={theme.keyLightColor}
        castShadow={graphics.shadows}
        shadow-mapSize={[graphics.shadowMapSize, graphics.shadowMapSize]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />
      <hemisphereLight args={[theme.hemiSkyColor, '#090f24', 0.85]} />
      <directionalLight position={[-180, -90, 220]} intensity={1.1} color={theme.rimLightColor} />

      {/* Procedural Deep-Space Nebula Skybox */}
      <mesh ref={skyboxRef} frustumCulled={false} renderOrder={-100}>
        <sphereGeometry args={[Math.max(2200, graphics.drawDistance * 0.78), 28, 20]} />
        <primitive object={nebulaMat} attach="material" />
      </mesh>

      {/* Multi-Spectral Twinkling Starfield */}
      <points ref={starGroupRef} geometry={starGeo} material={starMat} frustumCulled={false} />

      {/* Primary Cinematic Gas Giant with Rings & Atmospheric Fresnel Halo */}
      <group position={[-480, 130, -1350]} rotation={[0.24, 0.35, -0.28]}>
        <group ref={gasGiantRef}>
          <mesh>
            <sphereGeometry args={[280, graphics.planetSegments, graphics.planetSegments]} />
            <meshStandardMaterial
              map={envTex.bundle.gasGiantMap}
              roughness={0.82}
              metalness={0.06}
              envMapIntensity={0.4}
            />
          </mesh>
        </group>

        {/* Fresnel Atmospheric Rim Shell */}
        {graphics.postGlowEnabled && (
          <mesh scale={1.045}>
            <sphereGeometry args={[280, graphics.planetSegments, graphics.planetSegments]} />
            <primitive object={atmosphereMat} attach="material" />
          </mesh>
        )}

        {/* Tilted Planetary Ring System */}
        <mesh rotation={[Math.PI * 0.47, 0.1, 0]}>
          <planeGeometry args={[1240, 1240]} />
          <primitive object={ringMat} attach="material" />
        </mesh>
      </group>

      {/* Secondary Scarred Rocky Moon */}
      <mesh ref={moonRef} position={[620, -110, -920]}>
        <sphereGeometry
          args={[
            92,
            Math.max(20, graphics.planetSegments - 12),
            Math.max(20, graphics.planetSegments - 12),
          ]}
        />
        <meshStandardMaterial
          map={envTex.bundle.moonMap}
          roughness={0.92}
          metalness={0.08}
          envMapIntensity={0.35}
        />
      </mesh>

      {/* Distant Warm Dwarf Star Accent */}
      <mesh position={[1200, 560, -1700]}>
        <sphereGeometry args={[32, 16, 16]} />
        <meshBasicMaterial color={theme.keyLightColor} toneMapped={false} />
      </mesh>

      {/* Instanced Asteroid Belt for Speed Parallax & Spatial Depth */}
      <instancedMesh
        key={`asteroids-${graphics.asteroidCount}-${graphics.environmentDetail}`}
        ref={asteroidsRef}
        args={[asteroidGeo, asteroidMat, graphics.asteroidCount]}
        frustumCulled={false}
      />

      {/* Orbital Navigation Relay Beacons */}
      {beacons.map((b, idx) => (
        <group key={idx} position={b.pos} scale={b.scale}>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <torusGeometry args={[14, 0.55, 8, 24]} />
            <meshStandardMaterial color="#334155" metalness={0.85} roughness={0.32} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <torusGeometry args={[12.8, 0.16, 6, 24]} />
            <meshStandardMaterial
              color={theme.beaconColor}
              emissive={theme.beaconColor}
              emissiveIntensity={graphics.postGlowEnabled ? 1.6 : 0.9}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
