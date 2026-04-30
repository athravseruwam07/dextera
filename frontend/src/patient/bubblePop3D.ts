export type BubblePopDifficulty = "easy" | "medium" | "hard";

export type BubblePopWorldPoint = {
  x: number;
  z: number;
};

export type BubblePopItem3D = BubblePopWorldPoint & {
  id: string;
  vx: number;
  vz: number;
  radius: number;
  depth: number;
  target: boolean;
  scaleJit: number;
  floatPhase: number;
  status: "active" | "popping" | "bad";
};

export const bubblePopWorld = {
  width: 8.8,
  depth: 5.2,
  xMin: -4.4,
  xMax: 4.4,
  zMin: -2.6,
  zMax: 2.6
};

export const bubblePopSpacing = {
  active: 1.35,
  popped: 1.75,
  cursor: 1.1
};

const bubbleSlots = [
  { x: 22, y: 26 },
  { x: 52, y: 20 },
  { x: 78, y: 26 },
  { x: 26, y: 52 },
  { x: 50, y: 56 },
  { x: 74, y: 52 }
];

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function bubbleWorldDistance(a: BubblePopWorldPoint, b: BubblePopWorldPoint) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function handPositionToBubbleWorld(position: { x: number; y: number }): BubblePopWorldPoint {
  return {
    x: (position.x / 100 - 0.5) * bubblePopWorld.width,
    z: (position.y / 100 - 0.5) * bubblePopWorld.depth
  };
}

export function bubbleWorldToHandPosition(point: BubblePopWorldPoint) {
  return {
    x: ((point.x / bubblePopWorld.width) + 0.5) * 100,
    y: ((point.z / bubblePopWorld.depth) + 0.5) * 100,
    z: 0
  };
}

export function bubblePopVisualHitScore(
  cursor: { x: number; y: number },
  bubble: BubblePopWorldPoint & { scaleJit: number },
  board: { width: number; height: number },
  accessibilityMode: boolean
) {
  const center = bubbleWorldToHandPosition(bubble);
  const dx = ((cursor.x - center.x) / 100) * board.width;
  const dy = ((cursor.y - center.y) / 100) * board.height;
  const baseBubble = accessibilityMode ? 86 : 72;
  const maxBubble = accessibilityMode ? 132 : 120;
  const bubbleDiameter = clampNumber(board.height * (accessibilityMode ? 0.22 : 0.18), baseBubble, maxBubble) * bubble.scaleJit;
  const cursorDiameter = accessibilityMode ? 62 : 52;
  const hitRadius = bubbleDiameter * 0.48 + cursorDiameter * 0.18;
  return Math.hypot(dx, dy) / hitRadius;
}

function percentPointToWorld(point: { x: number; y: number }): BubblePopWorldPoint {
  return handPositionToBubbleWorld(point);
}

function hashUnit(seed: number) {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967295;
}

function bubbleSlotsForSeed(seed: number) {
  const order = [0, 1, 2, 3, 4, 5];
  let s = Math.max(1, seed) * 73856093;
  for (let i = order.length - 1; i > 0; i -= 1) {
    s = (s * 48271 + 65521) >>> 0;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((slotIdx) => bubbleSlots[slotIdx]);
}

function bubbleRadius(accessibilityMode: boolean, scale: number) {
  return (accessibilityMode ? 0.56 : 0.46) * scale;
}

function createBubblePopItem3D(seed: number, index: number, point: BubblePopWorldPoint, accessibilityMode: boolean): BubblePopItem3D {
  const scaleJit = clampNumber(0.94 + hashUnit(seed + index * 31) * 0.14, 0.94, 1.08);
  const angle = hashUnit(seed * 17 + index * 47) * Math.PI * 2;
  const baseSpeed = accessibilityMode ? 0.12 : 0.18;
  const speed = baseSpeed + hashUnit(seed * 23 + index * 19) * 0.08;
  return {
    id: `bubble3d-${seed}-${index}-${Math.round(point.x * 100)}-${Math.round(point.z * 100)}`,
    x: point.x,
    z: point.z,
    vx: Math.cos(angle) * speed,
    vz: Math.sin(angle) * speed,
    radius: bubbleRadius(accessibilityMode, scaleJit),
    depth: 0.14 + hashUnit(seed * 29 + index * 13) * 0.48,
    target: index % 3 !== 1,
    scaleJit,
    floatPhase: hashUnit(seed * 41 + index * 11) * Math.PI * 2,
    status: "active"
  };
}

function jitteredWorldPoint(seed: number, slot: { x: number; y: number }, index: number, accessibilityMode: boolean): BubblePopWorldPoint {
  const jitterX = (hashUnit(seed * 11 + index * 67) - 0.5) * (accessibilityMode ? 0.22 : 0.34);
  const jitterZ = (hashUnit(seed * 13 + index * 71) - 0.5) * (accessibilityMode ? 0.16 : 0.26);
  const base = percentPointToWorld(slot);
  const radius = accessibilityMode ? 0.62 : 0.52;
  return {
    x: clampNumber(base.x + jitterX, bubblePopWorld.xMin + radius, bubblePopWorld.xMax - radius),
    z: clampNumber(base.z + jitterZ, bubblePopWorld.zMin + radius, bubblePopWorld.zMax - radius)
  };
}

function isFarEnough(candidate: BubblePopWorldPoint, others: readonly BubblePopWorldPoint[], minDistance: number) {
  return others.every((point) => bubbleWorldDistance(candidate, point) >= minDistance);
}

export function makeBubblePop3DLayout(seed: number, accessibilityMode: boolean): BubblePopItem3D[] {
  for (let world = 0; world < 96; world += 1) {
    const s = seed + world;
    const slots = bubbleSlotsForSeed(s);
    const points: BubblePopWorldPoint[] = [];
    let failed = false;
    for (let i = 0; i < 6; i += 1) {
      let point = jitteredWorldPoint(s, slots[i], i, accessibilityMode);
      for (let guard = 0; guard < 28 && !isFarEnough(point, points, bubblePopSpacing.active); guard += 1) {
        const angle = hashUnit(s * 83 + i * 17 + guard * 31) * Math.PI * 2;
        point = {
          x: clampNumber(point.x + Math.cos(angle) * 0.16, bubblePopWorld.xMin + 0.55, bubblePopWorld.xMax - 0.55),
          z: clampNumber(point.z + Math.sin(angle) * 0.16, bubblePopWorld.zMin + 0.55, bubblePopWorld.zMax - 0.55)
        };
      }
      if (!isFarEnough(point, points, bubblePopSpacing.active)) {
        failed = true;
        break;
      }
      points.push(point);
    }
    if (!failed) {
      return points.map((point, index) => createBubblePopItem3D(seed, index, point, accessibilityMode));
    }
  }
  return bubbleSlotsForSeed(seed).map((slot, index) => createBubblePopItem3D(seed, index, percentPointToWorld(slot), accessibilityMode));
}

export function makeReplacementBubblePop3D(
  seed: number,
  existing: readonly BubblePopWorldPoint[],
  avoid: { popped?: BubblePopWorldPoint | null; cursor?: BubblePopWorldPoint | null },
  accessibilityMode: boolean
): BubblePopItem3D {
  const slots = bubbleSlotsForSeed(seed);
  const popped = avoid.popped ?? null;
  const cursor = avoid.cursor ?? null;
  const radius = accessibilityMode ? 0.62 : 0.52;

  const ok = (candidate: BubblePopWorldPoint) =>
    isFarEnough(candidate, existing, bubblePopSpacing.active) &&
    (!popped || bubbleWorldDistance(candidate, popped) >= bubblePopSpacing.popped) &&
    (!cursor || bubbleWorldDistance(candidate, cursor) >= bubblePopSpacing.cursor);

  for (let attempt = 0; attempt < 180; attempt += 1) {
    const slot = slots[attempt % slots.length];
    const point = jitteredWorldPoint(seed + attempt * 23, slot, attempt, accessibilityMode);
    if (ok(point)) {
      return createBubblePopItem3D(seed, 0, point, accessibilityMode);
    }
  }

  for (let attempt = 0; attempt < 520; attempt += 1) {
    const point = {
      x: bubblePopWorld.xMin + radius + hashUnit(seed * 97 + attempt * 19) * (bubblePopWorld.width - radius * 2),
      z: bubblePopWorld.zMin + radius + hashUnit(seed * 101 + attempt * 23) * (bubblePopWorld.depth - radius * 2)
    };
    if (ok(point)) {
      return createBubblePopItem3D(seed, 0, point, accessibilityMode);
    }
  }

  let best = jitteredWorldPoint(seed, slots[0], 0, accessibilityMode);
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < 620; attempt += 1) {
    const point = attempt < 220
      ? jitteredWorldPoint(seed + attempt * 37, slots[attempt % slots.length], attempt, accessibilityMode)
      : {
          x: bubblePopWorld.xMin + radius + hashUnit(seed * 113 + attempt * 29) * (bubblePopWorld.width - radius * 2),
          z: bubblePopWorld.zMin + radius + hashUnit(seed * 127 + attempt * 31) * (bubblePopWorld.depth - radius * 2)
        };
    const activeScore = existing.length ? Math.min(...existing.map((item) => bubbleWorldDistance(point, item))) : bubblePopSpacing.active;
    const poppedScore = popped ? bubbleWorldDistance(point, popped) : bubblePopSpacing.popped;
    const cursorScore = cursor ? bubbleWorldDistance(point, cursor) : bubblePopSpacing.cursor;
    const score = Math.min(activeScore / bubblePopSpacing.active, poppedScore / bubblePopSpacing.popped, cursorScore / bubblePopSpacing.cursor);
    if (score > bestScore) {
      bestScore = score;
      best = point;
    }
  }

  return createBubblePopItem3D(seed, 0, best, accessibilityMode);
}

export function moveBubblePopItems(
  items: readonly BubblePopItem3D[],
  dtSeconds: number,
  difficulty: BubblePopDifficulty,
  accessibilityMode: boolean
): BubblePopItem3D[] {
  const difficultySpeed = difficulty === "hard" ? 1.28 : difficulty === "medium" ? 1.08 : 0.92;
  const speed = accessibilityMode ? difficultySpeed * 0.68 : difficultySpeed;
  return items.map((item) => {
    if (item.status !== "active") return item;
    let nextX = item.x + item.vx * dtSeconds * speed;
    let nextZ = item.z + item.vz * dtSeconds * speed;
    let nextVx = item.vx;
    let nextVz = item.vz;
    const minX = bubblePopWorld.xMin + item.radius;
    const maxX = bubblePopWorld.xMax - item.radius;
    const minZ = bubblePopWorld.zMin + item.radius;
    const maxZ = bubblePopWorld.zMax - item.radius;

    if (nextX < minX || nextX > maxX) {
      nextX = clampNumber(nextX, minX, maxX);
      nextVx = -nextVx;
    }
    if (nextZ < minZ || nextZ > maxZ) {
      nextZ = clampNumber(nextZ, minZ, maxZ);
      nextVz = -nextVz;
    }

    return { ...item, x: nextX, z: nextZ, vx: nextVx, vz: nextVz };
  });
}
