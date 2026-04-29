import { useId } from "react";
import type { GameId } from "../types";

const taglines: Record<GameId, string> = {
  "ball-pickup":
    "Grasp timing and lift-release cycles on tabletop targets.",
  "finger-tap-piano": "Timed finger isolation on a gentle keyboard lane.",
  "bubble-pop": "Reach and poke floating spheres for dexterity bursts.",
  "carrom-flick": "Directed flicks and aim lines toward corner cues."
};

export function rehabGameCatalogTagline(gameId: GameId): string {
  return taglines[gameId];
}

/** Lightweight SVG vignettes — no raster assets — one per catalog game theme. */
export function RehabGameCatalogArt({ gameId }: { gameId: GameId }) {
  const uid = useId().replace(/:/g, "");

  switch (gameId) {
    case "ball-pickup":
      return (
        <svg className="rg-viz-svg" viewBox="0 0 280 92" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <defs>
            <linearGradient id={`vizBallBg-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ccfbf1" stopOpacity={0.9} />
              <stop offset="100%" stopColor="#e6fffa" stopOpacity={0.45} />
            </linearGradient>
            <linearGradient id={`vizBallOrb-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#99f6e4" />
              <stop offset="100%" stopColor="#2dd4bf" />
            </linearGradient>
          </defs>
          <rect width="280" height="92" fill={`url(#vizBallBg-${uid})`} />
          {/* motion arc */}
          <path d="M 36 72 Q 118 38 218 62" stroke="#5eead4" strokeOpacity={0.45} strokeWidth="2.5" fill="none" strokeDasharray="4 8" strokeLinecap="round" />
          {/* ball */}
          <circle cx="218" cy="62" r="14" fill={`url(#vizBallOrb-${uid})`} opacity={0.95} />
          <circle cx="213" cy="56" r="4" fill="#fff" fillOpacity={0.5} />
          {/* basket hint */}
          <path d="M 52 70 L 48 78 L 86 78 L 82 70 Z" fill="#94a3b8" fillOpacity={0.25} stroke="#0d9488" strokeOpacity={0.35} strokeWidth="1.2" />
          <ellipse cx="68" cy="78" rx="22" ry="4" fill="#cbd5e1" fillOpacity={0.35} />
        </svg>
      );
    case "finger-tap-piano":
      return (
        <svg className="rg-viz-svg" viewBox="0 0 280 92" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <defs>
            <linearGradient id={`vizPianoBg-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#eef2ff" />
              <stop offset="55%" stopColor="#e8f4ff" />
              <stop offset="100%" stopColor="#f1f5f9" />
            </linearGradient>
          </defs>
          <rect width="280" height="92" fill={`url(#vizPianoBg-${uid})`} />
          {/* white keys */}
          {[0, 1, 2, 3, 4].map((k) => (
            <rect
              key={k}
              x={48 + k * 36}
              y="28"
              width="30"
              height="46"
              rx="3"
              fill="#fff"
              stroke="#c7d2fe"
              strokeOpacity={0.75}
              strokeWidth="1"
            />
          ))}
          {/* black keys */}
          <rect x="76" y="28" width="12" height="26" rx="2" fill="#312e81" fillOpacity={0.78} />
          <rect x="112" y="28" width="12" height="26" rx="2" fill="#312e81" fillOpacity={0.78} />
          <rect x="184" y="28" width="12" height="26" rx="2" fill="#312e81" fillOpacity={0.78} />
          {/* tap ripple */}
          <circle cx="132" cy="58" r="10" stroke="#6366f1" strokeOpacity={0.35} strokeWidth="1.5" fill="none" />
        </svg>
      );
    case "bubble-pop":
      return (
        <svg className="rg-viz-svg" viewBox="0 0 280 92" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <defs>
            <linearGradient id={`vizBubbleBg-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f5f3ff" />
              <stop offset="100%" stopColor="#ede9fe" stopOpacity={0.45} />
            </linearGradient>
            <radialGradient id={`vizBubbleA-${uid}`} cx="45%" cy="40%" r="55%">
              <stop offset="0%" stopColor="#e9d5ff" stopOpacity={0.85} />
              <stop offset="100%" stopColor="#c4b5fd" stopOpacity={0.35} />
            </radialGradient>
          </defs>
          <rect width="280" height="92" fill={`url(#vizBubbleBg-${uid})`} />
          <circle cx="78" cy="44" r="22" fill={`url(#vizBubbleA-${uid})`} stroke="#a78bfa" strokeOpacity={0.35} strokeWidth="1.2" />
          <circle cx="134" cy="56" r="14" fill="#ddd6fe" fillOpacity={0.55} stroke="#8b5cf6" strokeOpacity={0.25} strokeWidth="1" />
          <circle cx="198" cy="38" r="18" fill="#ede9fe" stroke="#a855f7" strokeOpacity={0.2} strokeWidth="1" />
          {/* tiny sparkle */}
          <path d="M 210 64 L212 58 L218 62 L212 62 L208 56 Z" fill="#cbd5f1" fillOpacity={0.7} />
        </svg>
      );
    case "carrom-flick":
      return (
        <svg className="rg-viz-svg" viewBox="0 0 280 92" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <defs>
            <linearGradient id={`vizCarrBg-${uid}`} x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#fefce8" />
              <stop offset="100%" stopColor="#fdf4e7" />
            </linearGradient>
          </defs>
          <rect width="280" height="92" fill={`url(#vizCarrBg-${uid})`} />
          {/* board */}
          <rect x="52" y="22" width="178" height="52" rx="6" fill="#faf8f6" stroke="#e7d5bf" strokeWidth="1.2" opacity={0.95} />
          {/* aim dashed */}
          <line x1="98" y1="68" x2="224" y2="34" stroke="#d97757" strokeOpacity={0.35} strokeWidth="2" strokeDasharray="5 7" strokeLinecap="round" />
          {/* puck */}
          <circle cx="98" cy="68" r="10" fill="#fde68a" stroke="#eab308" strokeOpacity={0.45} strokeWidth="1.2" />
          <circle cx="95" cy="64" r="3" fill="#fffbeb" opacity={0.7} />
          {/* pocket triangle */}
          <path d="M 232 62 L246 74 L246 50 Z" fill="#fcd34d" fillOpacity={0.22} stroke="#d97706" strokeOpacity={0.38} strokeWidth="1.2" />
        </svg>
      );
    default:
      return (
        <svg className="rg-viz-svg" viewBox="0 0 280 92" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <defs>
            <linearGradient id={`vizDefaultBg-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#eef4ff" />
              <stop offset="100%" stopColor="#ecfeff" />
            </linearGradient>
          </defs>
          <rect width="280" height="92" fill={`url(#vizDefaultBg-${uid})`} />
          <circle cx="140" cy="46" r="28" stroke="#94a3b8" strokeOpacity={0.25} strokeWidth="2" fill="none" />
        </svg>
      );
  }
}
