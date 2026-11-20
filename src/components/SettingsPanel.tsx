import { useMemo } from 'react';
import { motion } from 'motion/react';
import { Volume2 } from 'lucide-react';
import { AudioManager } from '../audio/AudioManager';
import { getGraphicsPresetPatch } from '../config/graphics';
import { DEFAULT_SETTINGS } from '../config/ships';
import { STEERING_BOUNDS, STEERING_CONFIG } from '../config/steering';
import { evaluateDirectMouseCurveScalar } from '../engine/MouseResponseCurve';
import type {
  EffectQuality,
  GameSettings,
  GraphicsQuality,
  ShadowQuality,
} from '../types/game';
import { ObsidianCorners, ObsidianEnergySpine, TECH_EASE } from './ui/ObsidianUI';

interface SettingsPanelProps {
  settings: GameSettings;
  onUpdateSettings: (patch: Partial<GameSettings>) => void;
  onClose: () => void;
  closeLabel?: string;
}

const QUALITY_OPTIONS: Array<{ value: GraphicsQuality; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'ultra', label: 'Ultra' },
];

const SHADOW_OPTIONS: Array<{ value: ShadowQuality; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
];

const EFFECT_OPTIONS: Array<{ value: EffectQuality; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
];

function SteeringCurvePreview({ settings }: { settings: GameSettings }) {
  const { curvePath, linearPath, refSpeedXPos } = useMemo(() => {
    const W = 240;
    const H = 64;
    const padX = 8;
    const padY = 8;
    const plotW = W - padX * 2;
    const plotH = H - padY * 2;
    const maxU = 1.35;
    const maxY = 1.05;

    const curvePts: string[] = [];
    const linearPts: string[] = [];
    const steps = 64;
    for (let i = 0; i <= steps; i++) {
      const frac = i / steps;
      const u = frac * maxU;
      const out = evaluateDirectMouseCurveScalar(
        u,
        settings.responseCurve,
        STEERING_CONFIG.precisionLinearBlend,
        STEERING_CONFIG.softSaturationKnee,
      );
      const linOut = Math.min(1, u);
      const px = padX + frac * plotW;
      const py = padY + plotH - (out / maxY) * plotH;
      const lpy = padY + plotH - (linOut / maxY) * plotH;
      curvePts.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`);
      linearPts.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${lpy.toFixed(1)}`);
    }

    const refX = padX + (1.0 / maxU) * plotW;
    return {
      curvePath: curvePts.join(' '),
      linearPath: linearPts.join(' '),
      refSpeedXPos: refX,
    };
  }, [settings.responseCurve]);

  return (
    <div className="obsidian-surface px-3 py-2">
      <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">
        <span>Response Curve</span>
        <span className="tabular-nums text-[#38bdf8]">p={settings.responseCurve.toFixed(2)}</span>
      </div>
      <svg
        viewBox="0 0 240 64"
        className="h-14 w-full"
        aria-label="Nonlinear mouse steering response curve"
      >
        <line
          x1="8"
          y1="10.3"
          x2="232"
          y2="10.3"
          stroke="rgba(148,163,184,0.18)"
          strokeDasharray="3 3"
          strokeWidth="1"
        />
        <line
          x1={refSpeedXPos.toFixed(1)}
          y1="6"
          x2={refSpeedXPos.toFixed(1)}
          y2="58"
          stroke="rgba(56,189,248,0.4)"
          strokeDasharray="2 2"
          strokeWidth="1"
        />
        <path
          d={linearPath}
          fill="none"
          stroke="rgba(148,163,184,0.28)"
          strokeDasharray="3 3"
          strokeWidth="1.2"
        />
        <path d={curvePath} fill="none" stroke="#38bdf8" strokeWidth="2" />
      </svg>
    </div>
  );
}

export function SettingsPanel({
  settings,
  onUpdateSettings,
  onClose,
  closeLabel = 'Done',
}: SettingsPanelProps) {
  const effectiveBoundaryW = Math.round(
    STEERING_CONFIG.aimBoundaryWidth * settings.joystickRadius * 100,
  );
  const effectiveBoundaryH = Math.round(
    STEERING_CONFIG.aimBoundaryHeight * settings.joystickRadius * 100,
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: TECH_EASE }}
      className="obsidian-monolith obsidian-scroll relative max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6 sm:p-7"
    >
      <ObsidianEnergySpine orientation="horizontal" />
      <ObsidianCorners />

      <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <span className="font-mono text-[9px] uppercase tracking-[0.26em] text-[#38bdf8]">
            System Configuration
          </span>
          <h2 className="mt-0.5 font-display text-2xl font-bold uppercase tracking-[0.1em] text-slate-50">
            Settings
          </h2>
        </div>
        <button
          type="button"
          onMouseEnter={() => AudioManager.playUiHover()}
          onClick={() => {
            AudioManager.playUiClick('secondary');
            onUpdateSettings({ ...DEFAULT_SETTINGS });
          }}
          className="obsidian-surface obsidian-surface-interactive shrink-0 whitespace-nowrap px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-300 hover:text-[#38bdf8]"
        >
          Defaults
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Left Column: Direct Mouse Steering, Camera & Audio */}
        <div className="space-y-3.5">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#38bdf8]">
            Steering
          </h3>

          <SteeringCurvePreview settings={settings} />

          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="setting-mouse-sens" className="text-slate-300">
                  Sensitivity
                </label>
                <span className="font-mono text-[11px] tabular-nums text-[#38bdf8]">
                  {settings.mouseSensitivity.toFixed(2)}x
                </span>
              </div>
              <input
                id="setting-mouse-sens"
                type="range"
                min={STEERING_BOUNDS.mouseSensitivity.min}
                max={STEERING_BOUNDS.mouseSensitivity.max}
                step={0.05}
                value={settings.mouseSensitivity}
                onChange={(e) =>
                  onUpdateSettings({ mouseSensitivity: parseFloat(e.target.value) })
                }
                className="starfall-slider mt-1.5 w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="setting-response-curve" className="text-slate-300">
                  Curve
                </label>
                <span className="font-mono text-[11px] tabular-nums text-[#38bdf8]">
                  {settings.responseCurve.toFixed(2)}
                </span>
              </div>
              <input
                id="setting-response-curve"
                type="range"
                min={STEERING_BOUNDS.responseCurve.min}
                max={STEERING_BOUNDS.responseCurve.max}
                step={0.05}
                value={settings.responseCurve}
                onChange={(e) => onUpdateSettings({ responseCurve: parseFloat(e.target.value) })}
                className="starfall-slider mt-1.5 w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="setting-max-yaw" className="text-slate-300">
                  Max Yaw
                </label>
                <span className="font-mono text-[11px] tabular-nums text-[#38bdf8]">
                  {settings.maxYawRate.toFixed(1)} r/s
                </span>
              </div>
              <input
                id="setting-max-yaw"
                type="range"
                min={STEERING_BOUNDS.maxYawRate.min}
                max={STEERING_BOUNDS.maxYawRate.max}
                step={0.1}
                value={settings.maxYawRate}
                onChange={(e) => onUpdateSettings({ maxYawRate: parseFloat(e.target.value) })}
                className="starfall-slider mt-1.5 w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="setting-max-pitch" className="text-slate-300">
                  Max Pitch
                </label>
                <span className="font-mono text-[11px] tabular-nums text-[#38bdf8]">
                  {settings.maxPitchRate.toFixed(1)} r/s
                </span>
              </div>
              <input
                id="setting-max-pitch"
                type="range"
                min={STEERING_BOUNDS.maxPitchRate.min}
                max={STEERING_BOUNDS.maxPitchRate.max}
                step={0.1}
                value={settings.maxPitchRate}
                onChange={(e) => onUpdateSettings({ maxPitchRate: parseFloat(e.target.value) })}
                className="starfall-slider mt-1.5 w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="setting-yaw-sens" className="text-slate-300">
                  Yaw Scale
                </label>
                <span className="font-mono text-[11px] tabular-nums text-[#38bdf8]">
                  {settings.yawSensitivity.toFixed(2)}x
                </span>
              </div>
              <input
                id="setting-yaw-sens"
                type="range"
                min={STEERING_BOUNDS.yawSensitivity.min}
                max={STEERING_BOUNDS.yawSensitivity.max}
                step={0.05}
                value={settings.yawSensitivity}
                onChange={(e) =>
                  onUpdateSettings({ yawSensitivity: parseFloat(e.target.value) })
                }
                className="starfall-slider mt-1.5 w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="setting-pitch-sens" className="text-slate-300">
                  Pitch Scale
                </label>
                <span className="font-mono text-[11px] tabular-nums text-[#38bdf8]">
                  {settings.pitchSensitivity.toFixed(2)}x
                </span>
              </div>
              <input
                id="setting-pitch-sens"
                type="range"
                min={STEERING_BOUNDS.pitchSensitivity.min}
                max={STEERING_BOUNDS.pitchSensitivity.max}
                step={0.05}
                value={settings.pitchSensitivity}
                onChange={(e) =>
                  onUpdateSettings({ pitchSensitivity: parseFloat(e.target.value) })
                }
                className="starfall-slider mt-1.5 w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="setting-input-smoothing" className="text-slate-300">
                  Smoothing
                </label>
                <span className="font-mono text-[11px] tabular-nums text-[#38bdf8]">
                  {settings.inputSmoothing <= 0.001
                    ? 'Off'
                    : `${Math.round(settings.inputSmoothing * 100)}%`}
                </span>
              </div>
              <input
                id="setting-input-smoothing"
                type="range"
                min={STEERING_BOUNDS.inputSmoothing.min}
                max={STEERING_BOUNDS.inputSmoothing.max}
                step={0.02}
                value={settings.inputSmoothing}
                onChange={(e) =>
                  onUpdateSettings({ inputSmoothing: parseFloat(e.target.value) })
                }
                className="starfall-slider mt-1.5 w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="setting-joystick-radius" className="text-slate-300">
                  Aim Box
                </label>
                <span className="font-mono text-[11px] tabular-nums text-[#38bdf8]">
                  {effectiveBoundaryW}%×{effectiveBoundaryH}%
                </span>
              </div>
              <input
                id="setting-joystick-radius"
                type="range"
                min={STEERING_BOUNDS.joystickRadius.min}
                max={STEERING_BOUNDS.joystickRadius.max}
                step={0.05}
                value={settings.joystickRadius}
                onChange={(e) =>
                  onUpdateSettings({ joystickRadius: parseFloat(e.target.value) })
                }
                className="starfall-slider mt-1.5 w-full"
              />
            </div>
          </div>

          <h3 className="border-t border-white/8 pt-3 font-mono text-[10px] uppercase tracking-[0.24em] text-[#38bdf8]">
            Camera & Audio
          </h3>

          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="setting-cam-dist" className="text-slate-300">
                  Distance
                </label>
                <span className="font-mono text-[11px] tabular-nums text-[#38bdf8]">
                  {settings.cameraDistance.toFixed(1)} m
                </span>
              </div>
              <input
                id="setting-cam-dist"
                type="range"
                min={7.2}
                max={13.5}
                step={0.2}
                value={settings.cameraDistance}
                onChange={(e) => onUpdateSettings({ cameraDistance: parseFloat(e.target.value) })}
                className="starfall-slider mt-1.5 w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="setting-cam-sens" className="text-slate-300">
                  Follow
                </label>
                <span className="font-mono text-[11px] tabular-nums text-[#38bdf8]">
                  {settings.cameraSensitivity.toFixed(2)}x
                </span>
              </div>
              <input
                id="setting-cam-sens"
                type="range"
                min={0.6}
                max={1.6}
                step={0.05}
                value={settings.cameraSensitivity}
                onChange={(e) =>
                  onUpdateSettings({ cameraSensitivity: parseFloat(e.target.value) })
                }
                className="starfall-slider mt-1.5 w-full"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="setting-volume" className="text-slate-300">
                Master Volume
              </label>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    AudioManager.unlock();
                    AudioManager.playUiClick('primary');
                  }}
                  className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#38bdf8] hover:text-[#bae6fd]"
                >
                  <Volume2 className="h-3 w-3" />
                  <span>Test</span>
                </button>
                <span className="font-mono text-[11px] tabular-nums text-[#38bdf8]">
                  {Math.round(settings.masterVolume * 100)}%
                </span>
              </div>
            </div>
            <input
              id="setting-volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.masterVolume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onUpdateSettings({ masterVolume: v });
                AudioManager.setMasterVolume(v);
              }}
              className="starfall-slider mt-1.5 w-full"
            />
          </div>

          <label className="obsidian-surface obsidian-surface-interactive flex cursor-pointer items-center justify-between px-3 py-2 text-xs text-slate-200">
            <span>Invert Pitch (Y-Axis)</span>
            <input
              type="checkbox"
              checked={settings.invertY}
              onChange={(e) => {
                AudioManager.playUiClick('secondary');
                onUpdateSettings({ invertY: e.target.checked });
              }}
              className="h-3.5 w-3.5 accent-[#38bdf8]"
            />
          </label>

          {import.meta.env.DEV && (
            <label className="obsidian-surface obsidian-surface-interactive flex cursor-pointer items-center justify-between border-[#38bdf8]/35 px-3 py-2 text-xs text-[#bae6fd]">
              <span>Dev Perf Monitor (F3)</span>
              <input
                type="checkbox"
                checked={settings.showPerfOverlay}
                onChange={(e) => {
                  AudioManager.playUiClick('secondary');
                  onUpdateSettings({ showPerfOverlay: e.target.checked });
                }}
                className="h-3.5 w-3.5 accent-[#38bdf8]"
              />
            </label>
          )}
        </div>

        {/* Right Column: Graphics & Performance */}
        <div className="space-y-4">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#38bdf8]">
            Graphics
          </h3>

          {/* Overall Quality Preset */}
          <div>
            <span className="text-xs text-slate-300">Preset</span>
            <div className="obsidian-surface mt-1.5 grid grid-cols-4 p-0.5">
              {QUALITY_OPTIONS.map((opt) => {
                const active = settings.graphicsQuality === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      AudioManager.playUiClick('secondary');
                      onUpdateSettings(getGraphicsPresetPatch(opt.value));
                    }}
                    className={`py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                      active
                        ? 'bg-[#38bdf8]/20 font-semibold text-[#e0f2fe] ring-1 ring-inset ring-[#38bdf8]/75'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Resolution Scale */}
          <div>
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="setting-res-scale" className="text-slate-300">
                Resolution Scale
              </label>
              <span className="font-mono text-[11px] tabular-nums text-[#38bdf8]">
                {Math.round(settings.resolutionScale * 100)}%
              </span>
            </div>
            <input
              id="setting-res-scale"
              type="range"
              min={0.65}
              max={1.0}
              step={0.05}
              value={settings.resolutionScale}
              onChange={(e) => onUpdateSettings({ resolutionScale: parseFloat(e.target.value) })}
              className="starfall-slider mt-1.5 w-full"
            />
          </div>

          {/* Shadow Quality */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-300">Shadows</span>
            <div className="obsidian-surface flex p-0.5">
              {SHADOW_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    AudioManager.playUiClick('secondary');
                    onUpdateSettings({ shadowQuality: opt.value });
                  }}
                  className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                    settings.shadowQuality === opt.value
                      ? 'bg-[#38bdf8]/20 font-semibold text-[#e0f2fe] ring-1 ring-inset ring-[#38bdf8]/75'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Particle / Effect Quality */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-300">Particles</span>
            <div className="obsidian-surface flex p-0.5">
              {EFFECT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    AudioManager.playUiClick('secondary');
                    onUpdateSettings({ particleQuality: opt.value });
                  }}
                  className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                    settings.particleQuality === opt.value
                      ? 'bg-[#38bdf8]/20 font-semibold text-[#e0f2fe] ring-1 ring-inset ring-[#38bdf8]/75'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Environment Detail */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-300">Environment</span>
            <div className="obsidian-surface flex p-0.5">
              {EFFECT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    AudioManager.playUiClick('secondary');
                    onUpdateSettings({ environmentDetail: opt.value });
                  }}
                  className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                    settings.environmentDetail === opt.value
                      ? 'bg-[#38bdf8]/20 font-semibold text-[#e0f2fe] ring-1 ring-inset ring-[#38bdf8]/75'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Draw Distance */}
          <div>
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="setting-draw-dist" className="text-slate-300">
                Draw Distance
              </label>
              <span className="font-mono text-[11px] tabular-nums text-[#38bdf8]">
                {Math.round(settings.drawDistance)} m
              </span>
            </div>
            <input
              id="setting-draw-dist"
              type="range"
              min={2000}
              max={5200}
              step={200}
              value={settings.drawDistance}
              onChange={(e) => onUpdateSettings({ drawDistance: parseFloat(e.target.value) })}
              className="starfall-slider mt-1.5 w-full"
            />
          </div>

          {/* Anti-Aliasing & Glow Toggles */}
          <div className="grid grid-cols-2 gap-2.5">
            <label className="obsidian-surface obsidian-surface-interactive flex cursor-pointer items-center justify-between px-3 py-2 text-[11px] text-slate-200">
              <span>Anti-Aliasing</span>
              <input
                type="checkbox"
                checked={settings.antialias}
                onChange={(e) => {
                  AudioManager.playUiClick('secondary');
                  onUpdateSettings({ antialias: e.target.checked });
                }}
                className="h-3.5 w-3.5 accent-[#38bdf8]"
              />
            </label>
            <label className="obsidian-surface obsidian-surface-interactive flex cursor-pointer items-center justify-between px-3 py-2 text-[11px] text-slate-200">
              <span>Atmos Glow</span>
              <input
                type="checkbox"
                checked={settings.postGlowEnabled}
                onChange={(e) => {
                  AudioManager.playUiClick('secondary');
                  onUpdateSettings({ postGlowEnabled: e.target.checked });
                }}
                className="h-3.5 w-3.5 accent-[#38bdf8]"
              />
            </label>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end border-t border-white/10 pt-4">
        <button
          type="button"
          onMouseEnter={() => AudioManager.playUiHover()}
          onClick={() => {
            AudioManager.playUiClick('primary');
            onClose();
          }}
          className="obsidian-cta-primary obsidian-scan shrink-0 whitespace-nowrap px-7 py-2.5 font-display text-xs font-bold uppercase tracking-[0.18em] text-[#e0f2fe] focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
        >
          {closeLabel}
        </button>
      </div>
    </motion.div>
  );
}
