import type { ReactNode } from 'react';
import { motion } from 'motion/react';

/** Engineered deceleration curve shared across all STARFALL UI transitions */
export const TECH_EASE = [0.22, 1, 0.36, 1] as const;

/** Precision Electric Cyber Blue corner brackets for Obsidian Monoliths */
export function ObsidianCorners({ subtle = false }: { subtle?: boolean }) {
  const accent = subtle ? 'border-[#38bdf8]/60' : 'border-[#38bdf8]';
  const dim = subtle ? 'border-[#38bdf8]/35' : 'border-[#38bdf8]/55';
  return (
    <>
      <span
        className={`pointer-events-none absolute left-0 top-0 h-2.5 w-2.5 border-l-2 border-t-2 ${accent}`}
        aria-hidden="true"
      />
      <span
        className={`pointer-events-none absolute right-0 top-0 h-2.5 w-2.5 border-r-2 border-t-2 ${dim}`}
        aria-hidden="true"
      />
      <span
        className={`pointer-events-none absolute bottom-0 left-0 h-2.5 w-2.5 border-b-2 border-l-2 ${dim}`}
        aria-hidden="true"
      />
      <span
        className={`pointer-events-none absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 ${accent}`}
        aria-hidden="true"
      />
    </>
  );
}

/** Calm traveling Electric Cyber Blue energy conduit along a monolith edge */
export function ObsidianEnergySpine({
  orientation = 'vertical',
  side = 'left',
}: {
  orientation?: 'vertical' | 'horizontal';
  side?: 'left' | 'right' | 'top';
}) {
  if (orientation === 'horizontal') {
    return (
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden bg-[#38bdf8]/20"
        aria-hidden="true"
      >
        <div className="obsidian-energy-beam-x h-full w-32" />
      </div>
    );
  }

  return (
    <div
      className={`pointer-events-none absolute inset-y-0 ${
        side === 'right' ? 'right-0' : 'left-0'
      } w-px overflow-hidden bg-[#38bdf8]/20`}
      aria-hidden="true"
    >
      <div className="obsidian-energy-beam h-28 w-full" />
    </div>
  );
}

/** Sleek 3px precision bar for telemetry, ratings, and score breakdowns */
export function ObsidianGauge({
  label,
  valueText,
  percent,
  accentClass = 'from-[#0284c7] via-[#38bdf8] to-[#bae6fd]',
}: {
  label: string;
  valueText: string;
  percent: number;
  accentClass?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
        <span className="uppercase tracking-[0.14em] text-slate-400">{label}</span>
        <span className="tabular-nums text-slate-200">{valueText}</span>
      </div>
      <div className="relative h-[3px] w-full overflow-hidden bg-slate-800/80">
        <motion.div
          className={`h-full bg-gradient-to-r ${accentClass}`}
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.42, ease: TECH_EASE }}
        />
      </div>
    </div>
  );
}

/** Unified notification / status strip */
export function ObsidianBanner({
  tone = 'info',
  icon,
  children,
  className = '',
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const toneStyles =
    tone === 'success'
      ? 'border-emerald-400/60 text-emerald-200'
      : tone === 'warning'
        ? 'border-amber-400/60 text-amber-200'
        : tone === 'danger'
          ? 'border-rose-400/65 text-rose-200'
          : 'border-[#38bdf8]/60 text-[#bae6fd]';

  return (
    <div
      role="status"
      className={`obsidian-surface obsidian-scan flex items-center gap-2.5 border-l-2 px-3.5 py-2 font-mono text-xs ${toneStyles} ${className}`}
    >
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
