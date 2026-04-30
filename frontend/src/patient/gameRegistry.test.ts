import { describe, expect, it } from "vitest";
import { patientGameManifests } from "./gameRegistry";
import type { GameId } from "../types";

const gameIds: GameId[] = ["ball-pickup", "finger-tap-piano", "bubble-pop", "carrom-flick"];

describe("patient game registry", () => {
  it("defines every patient game", () => {
    expect(Object.keys(patientGameManifests).sort()).toEqual([...gameIds].sort());
  });

  it("keeps calibration requirements aligned with game controls", () => {
    expect(patientGameManifests["ball-pickup"].calibration).toEqual(["open-fist"]);
    expect(patientGameManifests["finger-tap-piano"].calibration).toEqual(["open-fist", "finger-taps"]);
    expect(patientGameManifests["bubble-pop"].calibration).toEqual(["open-fist", "point-pinch"]);
    expect(patientGameManifests["carrom-flick"].calibration).toEqual(["open-fist", "finger-flick"]);
  });
});
