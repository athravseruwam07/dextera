import { useId } from "react";
import type { Difficulty, GameId } from "../types";

type AnimatedGamePreviewProps = {
  gameId: GameId;
  difficulty?: Difficulty;
};

const pianoFingers = ["Thumb", "Index", "Middle", "Ring", "Pinky"] as const;
const pianoNotes = ["C", "D", "E", "F", "G"] as const;

export function AnimatedGamePreview({ gameId, difficulty = "medium" }: AnimatedGamePreviewProps) {
  const uid = useId().replace(/:/g, "");

  switch (gameId) {
    case "ball-pickup":
      return (
        <div className="animated-game-preview animated-game-preview--ball" aria-hidden>
          <div className="ap-ball-table">
            <span className="ap-ball-zone ap-ball-zone--start" />
            <span className="ap-ball-zone ap-ball-zone--basket" />
            <span className="ap-ball-orb">
              <span className="ap-ball-orb__seam ap-ball-orb__seam--one" />
              <span className="ap-ball-orb__seam ap-ball-orb__seam--two" />
            </span>
            <span className="ap-ball-ghost-hand">
              <span className="ap-ball-ghost-hand__palm" />
              <span className="ap-ball-ghost-hand__finger ap-ball-ghost-hand__finger--one" />
              <span className="ap-ball-ghost-hand__finger ap-ball-ghost-hand__finger--two" />
              <span className="ap-ball-ghost-hand__finger ap-ball-ghost-hand__finger--three" />
              <span className="ap-ball-ghost-hand__finger ap-ball-ghost-hand__finger--four" />
              <span className="ap-ball-ghost-hand__thumb" />
              <span className="ap-ball-ghost-hand__wrist" />
            </span>
            <span className="ap-ball-basket">
              <span className="ap-ball-basket__wall" />
              <span className="ap-ball-basket__rim" />
              <span className="ap-ball-basket__base" />
            </span>
          </div>
        </div>
      );
    case "finger-tap-piano":
      if (difficulty === "hard") {
        return (
          <div className="animated-game-preview animated-game-preview--piano animated-game-preview--piano-hard piano-lanes-root piano-tiles-mode" aria-hidden>
            <div className="piano-tile-keydesk ap-piano-lanes-desk">
              <div className="piano-tile-keyboard-face">
                <div className="piano-tile-keys-grid">
                  {pianoFingers.map((finger, index) => (
                    <span className={`piano-tile-key piano-key-lane ap-piano-lane ap-piano-lane--${index + 1}`} key={finger}>
                      <span className="piano-key-lane__rail">
                        {[1, 2, 4].includes(index) ? <span className="piano-note-tile ap-piano-lane-note" /> : null}
                      </span>
                      <span className="piano-tile-key-front">
                        <span className="piano-tile-key-front__note">{pianoNotes[index]}</span>
                        <span className="piano-tile-key-front__finger">{finger}</span>
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      }
      return (
        <div className="animated-game-preview animated-game-preview--piano animated-game-preview--piano-classic" aria-hidden>
          <div className="piano-board ap-piano-classic-board">
            <div className="piano-keybed">
              <div className="piano-keybed__rail" />
              <div className="piano-keybed__deck">
                <div className="piano-black-keys">
                  <span className="piano-bk piano-bk--cd" />
                  <span className="piano-bk piano-bk--de" />
                  <span className="piano-bk piano-bk--fg" />
                </div>
                <div className="piano-white-keys">
                  {pianoFingers.map((finger, index) => (
                    <span className={`piano-key piano-key--white ap-piano-classic-key ap-piano-classic-key--${index + 1}`} key={finger}>
                      <span className="piano-key-note">{pianoNotes[index]}</span>
                      <span className="piano-key-label">{finger}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    case "bubble-pop":
      return (
        <div className="animated-game-preview animated-game-preview--bubble bubble-board bubble-pop-scene" aria-hidden>
          <div className="bubble-pop-bg-layer">
            <span className="bubble-pop-bg-drift bubble-pop-bg-drift--1" />
            <span className="bubble-pop-bg-drift bubble-pop-bg-drift--2" />
            <span className="bubble-pop-bg-mote ap-bubble-mote ap-bubble-mote--one" />
            <span className="bubble-pop-bg-mote ap-bubble-mote ap-bubble-mote--two" />
          </div>
          <div className="bubble-pop-depth-grid" />
          <div className="bubble-pop-surface">
            <svg className="bubble-pop-surface__wave" viewBox="0 0 480 72" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0 54 C76 72 154 42 238 54 C324 67 394 42 478 62 L478 144 L0 144 Z" fill="rgba(186,230,253,0.28)" />
              <path d="M0 52 C118 74 258 42 478 62" stroke="rgba(148,163,184,0.42)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </svg>
          </div>
          <div className="bubble-pop-bubbles-layer">
            <span className="bubble-pop-hit bubble-pop-hit--target ap-bubble-hit ap-bubble-hit--target ap-bubble-hit--pop">
              <span className="bubble-pop-hit__shell" />
              <span className="bubble-pop-sparkfx ap-bubble-sparkfx" />
              <span className="bubble-pop-hit__content"><span className="bubble-pop-hit__lbl">Pop</span></span>
            </span>
            <span className="bubble-pop-hit bubble-pop-hit--target ap-bubble-hit ap-bubble-hit--small">
              <span className="bubble-pop-hit__shell" />
              <span className="bubble-pop-hit__content"><span className="bubble-pop-hit__lbl">Pop</span></span>
            </span>
            <span className="bubble-pop-hit bubble-pop-hit--decoy ap-bubble-hit ap-bubble-hit--decoy">
              <span className="bubble-pop-hit__shell" />
              <span className="bubble-pop-hit__content"><span className="bubble-pop-hit__lbl bubble-pop-hit__lbl--decoy">Avoid</span></span>
            </span>
          </div>
          <span className="bubble-pop-aim-cursor bubble-pop-aim-cursor--pinch ap-bubble-cursor">
            <span className="bubble-pop-aim-cursor__pulse" />
            <span className="bubble-pop-aim-cursor__halo" />
            <span className="bubble-pop-aim-cursor__ring" />
            <span className="bubble-pop-aim-cursor__dot" />
          </span>
        </div>
      );
    case "carrom-flick":
      return (
        <svg className="animated-game-preview animated-game-preview--carrom" viewBox="0 0 280 132" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <defs>
            <radialGradient id={`apCarromBoard-${uid}`} cx="50%" cy="30%" r="76%">
              <stop offset="0%" stopColor="#f8e9c6" />
              <stop offset="62%" stopColor="#d59d58" />
              <stop offset="100%" stopColor="#7c3f16" />
            </radialGradient>
          </defs>
          <rect width="280" height="132" rx="12" fill={`url(#apCarromBoard-${uid})`} />
          <rect x="42" y="10" width="196" height="112" rx="12" fill="#f8e9c6" stroke="#7c3f16" strokeWidth="8" />
          <rect x="56" y="24" width="168" height="84" rx="5" fill="#f8e9c6" stroke="#7c2d12" strokeWidth="2.4" />
          {[{ x: 58, y: 26 }, { x: 222, y: 26 }, { x: 58, y: 106 }, { x: 222, y: 106 }].map((pocket) => (
            <circle key={`${pocket.x}-${pocket.y}`} cx={pocket.x} cy={pocket.y} r="8.5" fill="#1c160f" opacity="0.88" />
          ))}
          <circle cx="140" cy="66" r="17" fill="none" stroke="#7c2d12" strokeWidth="2" />
          <circle cx="140" cy="66" r="7" fill="none" stroke="#7c2d12" strokeWidth="1.4" />
          <path d="M 76 100 H 204 M 76 32 H 204" stroke="#7c2d12" strokeWidth="2.4" strokeLinecap="round" />
          <circle className="ap-carrom-coin ap-carrom-coin--queen" cx="140" cy="66" r="6" fill="#e83f70" stroke="#ffd1dd" strokeWidth="1.5" />
          <circle className="ap-carrom-coin ap-carrom-coin--left" cx="127" cy="66" r="6" fill="#fff1cf" stroke="#8b6b42" strokeWidth="1.5" />
          <circle className="ap-carrom-coin ap-carrom-coin--right" cx="153" cy="66" r="6" fill="#262626" stroke="#696969" strokeWidth="1.5" />
          <circle className="ap-carrom-coin ap-carrom-coin--top" cx="140" cy="53" r="6" fill="#fff1cf" stroke="#8b6b42" strokeWidth="1.5" />
          <circle className="ap-carrom-coin ap-carrom-coin--bottom" cx="140" cy="79" r="6" fill="#262626" stroke="#696969" strokeWidth="1.5" />
          <g className="ap-carrom-aim">
            <path className="ap-carrom-aim-forward" d="M 118 98 L 152 74" stroke="#10b981" strokeWidth="5" strokeLinecap="round" />
            <path className="ap-carrom-aim-pull" d="M 113 102 L 88 119" stroke="#dc2626" strokeWidth="4" strokeLinecap="round" />
            <path className="ap-carrom-aim-head" d="M 152 74 L 142 76 L 148 84 Z" fill="#10b981" />
          </g>
          <g className="ap-carrom-puck">
            <circle cx="108" cy="105" r="10" fill="#0f4ab8" />
            <circle cx="108" cy="105" r="8.2" fill="#1663e6" />
            <circle cx="108" cy="105" r="4.8" fill="none" stroke="#9cc7ff" strokeWidth="1.4" />
            <circle cx="108" cy="105" r="2" fill="#0b3e9d" />
          </g>
        </svg>
      );
    default:
      return null;
  }
}
