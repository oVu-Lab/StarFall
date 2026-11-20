import { useCallback, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import type { GraphicsPreset } from '../config/graphics';
import type { CombatManager } from '../engine/combat/CombatManager';
import type { FlightController } from '../engine/FlightController';
import type { InputManager } from '../engine/InputManager';
import type { MissionManager } from '../engine/mission/MissionManager';
import type {
  FlightTelemetry,
  GamePhase,
  GameSettings,
  MenuSection,
  ShipId,
} from '../types/game';
import type { MissionEnvironmentTheme } from '../types/mission';
import { GameScene } from './GameScene';

interface FlightCanvasProps {
  phase: GamePhase;
  menuSection: MenuSection;
  activeShipId: ShipId;
  hangarShipId: ShipId;
  activeSkinId: string;
  hangarSkinId: string;
  flight: FlightController;
  combat: CombatManager;
  missionManager: MissionManager;
  missionTheme: MissionEnvironmentTheme;
  input: InputManager;
  settingsRef: React.MutableRefObject<GameSettings>;
  telemetryRef: React.MutableRefObject<FlightTelemetry>;
  graphics: GraphicsPreset;
  hangarOrbitRef: React.MutableRefObject<{ yaw: number; pitch: number }>;
  snapCameraSignal: number;
  onCanvasReady: (canvas: HTMLCanvasElement) => void;
  onPlayerDestroyed: () => void;
}

export function FlightCanvas({
  phase,
  menuSection,
  activeShipId,
  hangarShipId,
  activeSkinId,
  hangarSkinId,
  flight,
  combat,
  missionManager,
  missionTheme,
  input,
  settingsRef,
  telemetryRef,
  graphics,
  hangarOrbitRef,
  snapCameraSignal,
  onCanvasReady,
  onPlayerDestroyed,
}: FlightCanvasProps) {
  const [contextLost, setContextLost] = useState(false);

  const handleCreated = useCallback(
    ({ gl }: { gl: THREE.WebGLRenderer }) => {
      const dom = gl.domElement;
      onCanvasReady(dom);

      const onLost = (e: Event) => {
        e.preventDefault();
        setContextLost(true);
      };
      const onRestored = () => {
        setContextLost(false);
      };

      dom.addEventListener('webglcontextlost', onLost, false);
      dom.addEventListener('webglcontextrestored', onRestored, false);
    },
    [onCanvasReady],
  );

  if (contextLost) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#030712] text-slate-200">
        <div className="max-w-md border border-cyan-500/30 bg-[#071124] px-8 py-6 text-center">
          <h2 className="font-display text-xl font-semibold tracking-wider text-cyan-300">
            Graphics Context Interrupted
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            WebGL rendering was temporarily suspended by the browser. Reload the page to restore the 3D viewport.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400"
          >
            Reload Simulation
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 h-full w-full bg-[#030712]">
      <Canvas
        shadows={graphics.shadows ? 'percentage' : false}
        dpr={graphics.dprCap}
        camera={{ fov: 62, near: 0.25, far: graphics.drawDistance, position: [0, 16, 52] }}
        gl={{
          antialias: graphics.antialias,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.12,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        onCreated={handleCreated}
      >
        <GameScene
          phase={phase}
          menuSection={menuSection}
          activeShipId={activeShipId}
          hangarShipId={hangarShipId}
          activeSkinId={activeSkinId}
          hangarSkinId={hangarSkinId}
          flight={flight}
          combat={combat}
          missionManager={missionManager}
          missionTheme={missionTheme}
          input={input}
          settingsRef={settingsRef}
          telemetryRef={telemetryRef}
          graphics={graphics}
          hangarOrbitRef={hangarOrbitRef}
          snapCameraSignal={snapCameraSignal}
          onPlayerDestroyed={onPlayerDestroyed}
        />
      </Canvas>
    </div>
  );
}
