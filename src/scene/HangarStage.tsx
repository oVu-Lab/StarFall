import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface HangarStageProps {
  origin: THREE.Vector3;
  active: boolean;
  accentColor: string;
  transitionKey: string;
}

const PAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PAD_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uPulse;
  uniform vec3 uAccent;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    float angle = atan(p.y, p.x);

    // Polished obsidian bay deck with soft specular center reflection
    float deckBase = smoothstep(1.0, 0.18, r);
    vec3 col = vec3(0.025, 0.035, 0.065) * deckBase;

    // Soft under-hull glow pool reflecting onto the dark obsidian deck
    float centerGlow = exp(-r * r * 4.8);
    col += uAccent * centerGlow * (0.24 + uPulse * 0.22);

    // Precision concentric calibration rings
    float ring1 = smoothstep(0.011, 0.0, abs(r - 0.36));
    float ring2 = smoothstep(0.008, 0.0, abs(r - 0.64));
    float ring3 = smoothstep(0.013, 0.0, abs(r - 0.89));

    // Fine radial calibration ticks
    float ticks = step(0.55, fract((angle / 6.2831853 + 0.5) * 48.0));
    float tickBand = smoothstep(0.018, 0.0, abs(r - 0.76)) * ticks;

    // Restrained rotating telemetry radar sweep arc along outer bay track
    float sweepAngle = mod(angle - uTime * 0.42 + 6.2831853, 6.2831853);
    float sweepArc = smoothstep(1.35, 0.0, sweepAngle) * smoothstep(0.075, 0.0, abs(r - 0.85));

    // Expanding scan ring on ship/livery switch
    float scanWave = smoothstep(0.055, 0.0, abs(r - (1.0 - uPulse))) * uPulse;

    float lines = ring1 * 0.45 + ring2 * 0.28 + ring3 * 0.6 + tickBand * 0.26 + sweepArc * 0.55 + scanWave * 0.85;
    col += uAccent * lines * (0.82 + 0.1 * sin(uTime * 1.4));

    float edgeFade = smoothstep(1.0, 0.82, r);
    float alpha = clamp(deckBase * 0.62 + centerGlow * 0.28 + lines * 0.62, 0.0, 0.88) * edgeFade;

    gl_FragColor = vec4(col, alpha);
  }
`;

const DUST_COUNT = 36;

export function HangarStage({ origin, active, accentColor, transitionKey }: HangarStageProps) {
  const outerRingRef = useRef<THREE.Mesh>(null);
  const innerRingRef = useRef<THREE.Mesh>(null);
  const dustRef = useRef<THREE.Points>(null);
  const uplightRef = useRef<THREE.PointLight>(null);
  const rimLightRef = useRef<THREE.PointLight>(null);
  const pulseRef = useRef(0);
  const prevKeyRef = useRef(transitionKey);

  useEffect(() => {
    if (prevKeyRef.current !== transitionKey) {
      prevKeyRef.current = transitionKey;
      pulseRef.current = 1.0;
    }
  }, [transitionKey]);

  const padMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPulse: { value: 0 },
          uAccent: { value: new THREE.Color('#38bdf8') },
        },
        vertexShader: PAD_VERTEX,
        fragmentShader: PAD_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  useEffect(() => {
    const blended = new THREE.Color('#38bdf8').lerp(new THREE.Color(accentColor), 0.35);
    padMat.uniforms.uAccent.value.copy(blended);
  }, [padMat, accentColor]);

  const { dustGeo, dustMat, dustBaseY } = useMemo(() => {
    const positions = new Float32Array(DUST_COUNT * 3);
    const baseY = new Float32Array(DUST_COUNT);

    let seed = 13379;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < DUST_COUNT; i++) {
      const a = rand() * Math.PI * 2;
      const r = 1.0 + Math.sqrt(rand()) * 4.4;
      const y = -2.1 + rand() * 4.8;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(a) * r;
      baseY[i] = y;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: '#7dd3fc',
      size: 0.065,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    return { dustGeo: geo, dustMat: mat, dustBaseY: baseY };
  }, []);

  useEffect(() => {
    return () => {
      padMat.dispose();
      dustGeo.dispose();
      dustMat.dispose();
    };
  }, [padMat, dustGeo, dustMat]);

  useFrame((state, delta) => {
    if (!active) return;
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;

    pulseRef.current = THREE.MathUtils.damp(pulseRef.current, 0, 3.8, dt);
    padMat.uniforms.uTime.value = t;
    padMat.uniforms.uPulse.value = pulseRef.current;

    if (outerRingRef.current) {
      outerRingRef.current.rotation.z += dt * 0.07;
    }
    if (innerRingRef.current) {
      innerRingRef.current.rotation.z -= dt * 0.13;
    }
    if (uplightRef.current) {
      uplightRef.current.intensity = 1.9 + Math.sin(t * 1.5) * 0.2 + pulseRef.current * 1.1;
    }
    if (rimLightRef.current) {
      rimLightRef.current.intensity = 3.2 + Math.sin(t * 1.1) * 0.18 + pulseRef.current * 0.9;
    }

    if (dustRef.current) {
      const posAttr = dustRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < DUST_COUNT; i++) {
        let y = posAttr.getY(i) + dt * (0.12 + (i % 5) * 0.02);
        if (y > 2.8) y = -2.1 + ((dustBaseY[i] + 2.1) % 0.5);
        posAttr.setY(i, y);
      }
      posAttr.needsUpdate = true;
    }
  });

  if (!active) return null;

  return (
    <group position={[origin.x, origin.y, origin.z]} name="hangar-showcase-stage">
      {/* Cinematic Studio Showroom Lighting Rig — carves dramatic metallic silhouette separation */}
      <pointLight position={[5.0, 8.0, 6.0]} intensity={3.0} distance={28} decay={1.4} color="#e0f2fe" />
      <pointLight
        ref={rimLightRef}
        position={[-7.2, 3.6, -6.2]}
        intensity={3.2}
        distance={26}
        decay={1.4}
        color="#38bdf8"
      />
      <pointLight position={[6.8, 1.4, -4.8]} intensity={1.35} distance={24} decay={1.5} color="#93c5fd" />
      <pointLight
        ref={uplightRef}
        position={[0, -2.3, 0]}
        intensity={1.9}
        distance={14}
        decay={1.5}
        color="#38bdf8"
      />

      {/* Obsidian & Energy Docking Bay Deck Pad */}
      <group position={[0, -2.2, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
          <planeGeometry args={[10.0, 10.0]} />
          <primitive object={padMat} attach="material" />
        </mesh>

        {/* Precision Outer Energy Ring */}
        <mesh ref={outerRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[4.42, 4.49, 84]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.34}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Counter-Rotating Inner Calibration Ring */}
        <mesh ref={innerRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[3.1, 3.15, 56]} />
          <meshBasicMaterial
            color="#7dd3fc"
            transparent
            opacity={0.22}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Four Cardinal Obsidian Docking Clamps with Electric-Blue Energy Strips */}
        {[0, Math.PI * 0.5, Math.PI, Math.PI * 1.5].map((rot, idx) => (
          <group key={idx} rotation={[0, rot, 0]}>
            <mesh position={[0, 0.07, 4.62]}>
              <boxGeometry args={[0.9, 0.1, 0.28]} />
              <meshStandardMaterial color="#0b101b" metalness={0.9} roughness={0.22} />
            </mesh>
            <mesh position={[0, 0.13, 4.62]}>
              <boxGeometry args={[0.54, 0.025, 0.05]} />
              <meshBasicMaterial color="#38bdf8" transparent opacity={0.92} toneMapped={false} />
            </mesh>
          </group>
        ))}

        {/* Restrained Vertical Containment Energy Field */}
        <mesh position={[0, 0.72, 0]}>
          <cylinderGeometry args={[4.42, 4.48, 1.44, 56, 1, true]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.036}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>

      {/* Subtle Drifting Hangar Bay Atmospheric Motes */}
      <points ref={dustRef} geometry={dustGeo} material={dustMat} frustumCulled={false} />
    </group>
  );
}
