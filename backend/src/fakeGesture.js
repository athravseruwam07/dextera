const gestures = [
  "open",
  "fist",
  "point",
  "pinch",
  "tap_thumb",
  "tap_index",
  "tap_middle",
  "tap_ring",
  "tap_pinky",
  "flick"
];

const gestureProfiles = {
  open: { thumb: [5, 25], index: [0, 20], middle: [0, 20], ring: [0, 25], pinky: [0, 25] },
  fist: { thumb: [70, 95], index: [75, 100], middle: [75, 100], ring: [70, 100], pinky: [65, 95] },
  pinch: { thumb: [65, 95], index: [60, 90], middle: [10, 35], ring: [10, 35], pinky: [10, 35] },
  point: { thumb: [30, 80], index: [0, 25], middle: [70, 100], ring: [70, 100], pinky: [70, 100] },
  tap_thumb: { thumb: [70, 100], index: [0, 40], middle: [0, 40], ring: [0, 40], pinky: [0, 40] },
  tap_index: { thumb: [0, 40], index: [70, 100], middle: [0, 40], ring: [0, 40], pinky: [0, 40] },
  tap_middle: { thumb: [0, 40], index: [0, 40], middle: [70, 100], ring: [0, 40], pinky: [0, 40] },
  tap_ring: { thumb: [0, 40], index: [0, 40], middle: [0, 40], ring: [70, 100], pinky: [0, 40] },
  tap_pinky: { thumb: [0, 40], index: [0, 40], middle: [0, 40], ring: [0, 40], pinky: [70, 100] },
  flick: { thumb: [20, 60], index: [80, 100], middle: [20, 60], ring: [10, 45], pinky: [10, 45] }
};

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function fakeGestureEvent(patientId = "demo-patient-1") {
  const gesture = gestures[randomInt(0, gestures.length - 1)];
  const profile = gestureProfiles[gesture];

  return {
    patientId,
    gesture,
    thumb: randomInt(...profile.thumb),
    index: randomInt(...profile.index),
    middle: randomInt(...profile.middle),
    ring: randomInt(...profile.ring),
    pinky: randomInt(...profile.pinky),
    handX: Number(Math.random().toFixed(3)),
    handY: Number(Math.random().toFixed(3)),
    handZ: Number(Math.random().toFixed(3)),
    accuracy: randomInt(72, 99),
    timestamp: new Date().toISOString()
  };
}

module.exports = { fakeGestureEvent };
