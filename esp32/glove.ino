/**
 * Gloving ESP32 Firmware — Flex Sensor Reader
 *
 * Reads 5 analog flex sensors and prints one JSON object per line
 * over Serial at 115200 baud. The laptop bridge (bridge/bridge.js)
 * reads these values and forwards them to the backend API.
 *
 * Wiring:
 *   Thumb  → GPIO 34 (ADC1_CH6)
 *   Index  → GPIO 35 (ADC1_CH7)
 *   Middle → GPIO 32 (ADC1_CH4)
 *   Ring   → GPIO 33 (ADC1_CH5)
 *   Pinky  → GPIO 36 (VP / ADC1_CH0)
 *
 * Each flex sensor forms a voltage divider with a 10kΩ resistor.
 * ADC reads 0–4095 (12-bit). Values change as the finger bends.
 *
 * NOTE: Gesture classification is done on the backend/frontend using
 * calibration data. The ESP32 only sends raw sensor readings.
 *
 * Setup:
 *   1. Install "ESP32" board package in Arduino IDE
 *   2. Select board: "ESP32 Dev Module"
 *   3. Upload this sketch
 *   4. Open Serial Monitor at 115200 to verify JSON output
 *   5. Run bridge: cd bridge && node bridge.js
 */

// --- Pin assignments (change to match your wiring) ---
const int PIN_THUMB  = 34;
const int PIN_INDEX  = 35;
const int PIN_MIDDLE = 32;
const int PIN_RING   = 33;
const int PIN_PINKY  = 36;

// Interval between sensor readings (milliseconds)
const int READ_INTERVAL_MS = 50;  // 20 readings/second

void setup() {
  Serial.begin(115200);
  // ADC resolution: 12-bit → values 0–4095
  analogReadResolution(12);
  delay(500);  // let serial settle
}

void loop() {
  int thumb  = analogRead(PIN_THUMB);
  int index  = analogRead(PIN_INDEX);
  int middle = analogRead(PIN_MIDDLE);
  int ring   = analogRead(PIN_RING);
  int pinky  = analogRead(PIN_PINKY);

  // Print one JSON object per line — the bridge reads line-delimited JSON
  Serial.print("{");
  Serial.print("\"thumb\":");  Serial.print(thumb);  Serial.print(",");
  Serial.print("\"index\":");  Serial.print(index);  Serial.print(",");
  Serial.print("\"middle\":"); Serial.print(middle); Serial.print(",");
  Serial.print("\"ring\":");   Serial.print(ring);   Serial.print(",");
  Serial.print("\"pinky\":");  Serial.print(pinky);
  Serial.println("}");

  delay(READ_INTERVAL_MS);
}
