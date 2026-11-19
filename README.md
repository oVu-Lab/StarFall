<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.
https://ai.studio/apps/49f9382e-a5a8-4ac9-ad38-8127f285cebb

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Mouse steering model

STARFALL uses Pointer Lock `movementX` / `movementY` as CSS-pixel relative input. The amber
diamond is the unbounded accumulated virtual mouse; it is never recentered, clamped, or modified
by chase-camera motion. The cyan reticle is a separate physical cannon ray projected through the
active `PerspectiveCamera`, so the HUD, target selection, and projectile convergence agree.

The central rounded region limits the reachable cannon reticle. When the virtual mouse is outside
that region, steering compares the reticle to the boundary point in the same requested direction.
That preserves continuous turn demand while keeping an attainable zero-error state instead of
spinning forever after a large input. The tether always joins the two visible markers; its retained
length outside the region denotes stored virtual-mouse travel, while the reticle is at the matching
reachable direction.

The final alignment tuning is in `src/config/steering.ts`:

- `reticleInputGain: 0.12` keeps fine mouse corrections precise instead of jumping the cannon to an edge.
- `gimbalRotationGain: 0.06` transfers real hull rotation into the physical cannon gimbal. This overcomes
  the chase camera's follow cancellation without overshoot.
- `alignmentReferenceFraction: 0.26`, `alignmentLinearGain: 1.0`, and `alignmentQuadGain: 0.9` provide
  a smooth small-error response that rises to meaningful large-turn demand.
- `alignmentRateTauSec: 0.045` smooths changes without a perceptible input delay; the 0.5px soft
  deadzone removes numerical jitter while preserving small corrections.
