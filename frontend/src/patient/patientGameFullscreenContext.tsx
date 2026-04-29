import { createContext, useContext, type RefObject } from "react";

export type PatientGameFullscreenControls = {
  isFullscreen: boolean;
  isSupported: boolean;
  enterFullscreen: () => Promise<boolean>;
  exitFullscreen: () => Promise<void>;
  exitButtonRef: RefObject<HTMLButtonElement>;
};

export const PatientGameFullscreenContext = createContext<PatientGameFullscreenControls | null>(null);

export function usePatientGameFullscreenControls(): PatientGameFullscreenControls | null {
  return useContext(PatientGameFullscreenContext);
}
