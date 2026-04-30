import { describe, expect, it } from "vitest";
import {
  bubblePopSpacing,
  bubblePopWorld,
  bubblePopVisualHitScore,
  bubbleWorldDistance,
  bubbleWorldToHandPosition,
  handPositionToBubbleWorld,
  makeBubblePop3DLayout,
  makeReplacementBubblePop3D,
  moveBubblePopItems
} from "./bubblePop3D";

describe("Bubble Pop 3D helpers", () => {
  it("creates a separated 3D bubble layout", () => {
    const bubbles = makeBubblePop3DLayout(4, false);
    expect(bubbles).toHaveLength(6);

    for (let i = 0; i < bubbles.length; i += 1) {
      for (let j = i + 1; j < bubbles.length; j += 1) {
        expect(bubbleWorldDistance(bubbles[i], bubbles[j])).toBeGreaterThanOrEqual(bubblePopSpacing.active);
      }
    }
  });

  it("spawns replacement away from active bubbles, popped spot, and cursor", () => {
    const bubbles = makeBubblePop3DLayout(8, false);
    const popped = bubbles[0];
    const existing = bubbles.slice(1).map(({ x, z }) => ({ x, z }));
    const cursor = handPositionToBubbleWorld({ x: 50, y: 50 });
    const replacement = makeReplacementBubblePop3D(9, existing, { popped, cursor }, false);

    expect(existing.every((item) => bubbleWorldDistance(replacement, item) >= bubblePopSpacing.active)).toBe(true);
    expect(bubbleWorldDistance(replacement, popped)).toBeGreaterThanOrEqual(bubblePopSpacing.popped);
    expect(bubbleWorldDistance(replacement, cursor)).toBeGreaterThanOrEqual(bubblePopSpacing.cursor);
  });

  it("keeps moving bubbles inside the 3D board bounds", () => {
    const [bubble] = makeBubblePop3DLayout(2, false);
    const moved = moveBubblePopItems(
      [{ ...bubble, x: bubblePopWorld.xMax - bubble.radius / 2, z: bubblePopWorld.zMax - bubble.radius / 2, vx: 2, vz: 2 }],
      1,
      "hard",
      false
    )[0];

    expect(moved.x).toBeLessThanOrEqual(bubblePopWorld.xMax - moved.radius);
    expect(moved.z).toBeLessThanOrEqual(bubblePopWorld.zMax - moved.radius);
    expect(moved.vx).toBeLessThan(0);
    expect(moved.vz).toBeLessThan(0);
  });

  it("only treats visually hovered bubbles as hit candidates", () => {
    const [bubble] = makeBubblePop3DLayout(3, false);
    const center = bubbleWorldToHandPosition(bubble);
    const board = { width: 900, height: 450 };

    expect(bubblePopVisualHitScore(center, bubble, board, false)).toBeLessThanOrEqual(1);
    expect(bubblePopVisualHitScore({ x: center.x + 13, y: center.y }, bubble, board, false)).toBeGreaterThan(1);
    expect(bubblePopVisualHitScore({ x: center.x, y: center.y + 18 }, bubble, board, false)).toBeGreaterThan(1);
  });
});
