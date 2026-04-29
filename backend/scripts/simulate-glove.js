const { fakeGestureEvent } = require("../src/fakeGesture");

function getArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`POST ${url} failed with ${response.status}: ${text}`);
  }

  return response.json();
}

async function main() {
  const baseUrl = getArg("url", "http://localhost:4000");
  const patientId = getArg("patient", "demo-patient-1");
  const intervalMs = Number(getArg("interval", "1000"));
  const count = Number(getArg("count", "0"));
  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/glove/event`;
  let sent = 0;

  console.log(`Streaming fake glove events to ${endpoint}`);
  console.log(`patient=${patientId} interval=${intervalMs}ms count=${count || "infinite"}`);

  const send = async () => {
    const event = fakeGestureEvent(patientId);
    const saved = await postJson(endpoint, event);
    sent += 1;
    console.log(`${sent}: ${saved.gesture} thumb=${saved.thumb} index=${saved.index} middle=${saved.middle} ring=${saved.ring} pinky=${saved.pinky}`);

    if (count > 0 && sent >= count) {
      process.exit(0);
    }
  };

  await send();
  setInterval(() => {
    send().catch((error) => {
      console.error(error.message);
    });
  }, intervalMs);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
