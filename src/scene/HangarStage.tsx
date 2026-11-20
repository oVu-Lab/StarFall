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

    // Subtle deep-navy docking bay deck surface with radial falloff
    float deckBase = smoothstep(1.0, 0.25, r);
    vec3 col = vec3(0.05, 0.07, 0.12) * deckBase;

    // Soft center under-hull illumination
    float centerGlow = exp(-r * r * 5.2);
    col += uAccent * centerGlow * (0.20 + uPulse * 0.14);

    // Precision concentric calibration rings
    float ring1 = smoothstep(0.012, 0.0, abs(r - 0.34));
    float ring2 = smoothstep(0.009, 0.0, abs(r - 0.62));
    float ring3 = smoothstep(0.014, 0.0, abs(r - 0.88));

    // Segmented ticks along middle ring
    float ticks = step(0.45, fract((angle / 6.2831853 + 0.5) * 36.0));
    float tickBand = smoothstep(0.022, 0.0, abs(r - 0.74)) * ticks;

    // Subtle 4-axis crosshairs
    float axisX = smoothstep(0.006, 0.0, abs(p.y)) * smoothstep(0.24, 0.32, r) * smoothstep(0.92, 0.84, r);
    float axisY = smoothstep(0.006, 0.0, abs(p.x)) * smoothstep(0.24, 0.32, r) * smoothstep(0.92, 0.84, r);

    // Gentle expanding scan pulse on ship/skin switch
    float scanWave = smoothstep(0.06, 0.0, abs(r - (1.0 - uPulse))) * uPulse;

    float lines = ring1 * 0.42 + ring2 * 0.30 + ring3 * 0.55 + tickBand * 0.25 + (axisX + axisY) * 0.18 + scanWave * 0.65;
    col += uAccent * lines * (0.75 + 0.12 * sin(uTime * 1.4));

    float edgeFade = smoothstep(1.0, 0.78, r);
    float alpha = clamp(deckBase * 0.52 + centerGlow * 0.25 + lines * 0.58, 0.0, 0.82) * edgeFade;

    gl_FragColor = vec4(col, alpha);
  }
`;

const DUST_COUNT = 44;

export function HangarStage({ origin, active, accentColor, transitionKey }: HangarStageProps) {
  const outerRingRef = useRef<THREE.Mesh>(null);
  const innerRingRef = useRef<THREE.Mesh>(null);
  const dustRef = useRef<THREE.Points>(null);
  const uplightRef = useRef<THREE.PointLight>(null);
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
      const r = 1.2 + Math.sqrt(rand()) * 5.2;
      const y = -2.2 + rand() * 5.4;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(a) * r;
      baseY[i] = y;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: '#7dd3fc',
      size: 0.075,
      transparent: true,
      opacity: 0.3,
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

    pulseRef.current = THREE.MathUtils.damp(pulseRef.current, 0, 4.2, dt);
    padMat.uniforms.uTime.value = t;
    padMat.uniforms.uPulse.value = pulseRef.current;

    if (outerRingRef.current) {
      outerRingRef.current.rotation.z += dt * 0.08;
    }
    if (innerRingRef.current) {
      innerRingRef.current.rotation.z -= dt * 0.14;
    }
    if (uplightRef.current) {
      uplightRef.current.intensity = 1.55 + Math.sin(t * 1.6) * 0.18 + pulseRef.current * 0.85;
    }

    if (dustRef.current) {
      const posAttr = dustRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < DUST_COUNT; i++) {
        let y = posAttr.getY(i) + dt * (0.14 + (i % 5) * 0.025);
        if (y > 3.2) y = -2.2 + ((dustBaseY[i] + 2.2) % 0.6);
        posAttr.setY(i, y);
      }
      posAttr.needsUpdate = true;
    }
  });

  if (!active) return null;

  return (
    <group position={[origin.x, origin.y, origin.z]} name="hangar-showcase-stage">
      {/* Studio Showroom Lighting Rig — separates dark hull armor cleanly from deep space */}
      <pointLight position={[5.5, 7.5, 6.5]} intensity={2.4} distance={26} decay={1.5} color="#e0f2fe" />
      <pointLight position={[-7.0, 3.2, -6.5]} intensity={2.6} distance={24} decay={1.5} color="#38bdf8" />
      <pointLight position={[6.5, 1.2, -5.0]} intensity={1.15} distance={22} decay={1.6} color="#93c5fd" />
      <pointLight
        ref={uplightRef}
        position={[0, -2.5, 0]}
        intensity={1.55}
        distance={14}
        decay={1.6}
        color="#38bdf8"
      />

      {/* Holographic Docking Bay Deck Pad */}
      <group position={[0, -2.35, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
          <planeGeometry args={[12.8, 12.8]} />
          <primitive object={padMat} attach="material" />
        </mesh>

        {/* Precision Outer Telemetry Ring */}
        <mesh ref={outerRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[5.55, 5.62, 72]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.28}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Counter-Rotating Inner Calibration Ring */}
        <mesh ref={innerRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[3.95, 4.0, 48]} />
          <meshBasicMaterial
            color="#7dd3fc"
            transparent
            opacity={0.2}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Four Cardinal Docking Clamp Markers */}
        {[0, Math.PI * 0.5, Math.PI, Math.PI * 1.5].map((rot, idx) => (
          <group key={idx} rotation={[0, rot, 0]}>
            <mesh position={[0, 0.06, 5.75]}>
              <boxGeometry args={[0.95, 0.08, 0.24]} />
              <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.35} />
            </mesh>
            <mesh position={[0, 0.11, 5.75]}>
              <boxGeometry args={[0.52, 0.03, 0.06]} />
              <meshBasicMaterial color="#38bdf8" transparent opacity={0.85} toneMapped={false} />
            </mesh>
          </group>
        ))}

        {/* Restrained Volumetric Bay Field Rim */}
        <mesh position={[0, 0.75, 0]}>
          <cylinderGeometry args={[5.55, 5.6, 1.5, 48, 1, true]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.032}
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
