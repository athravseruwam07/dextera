import {
  endBackendSession,
  startBackendSession,
  uploadPatientSessionGestures,
  apiFetch,
  type CalibrationPayload
} from "../lib/backend";
import type { Assignment, FingerBends, PatientCareAssignment, SessionResult } from "../types";
import { assignmentToExerciseTemplate, saveSessionResultLocal } from "./patientData";

/** Links patient-game exercises to clinician-style assignment rows the backend recognizes. */
function patientCareToAssignmentStub(assignment: PatientCareAssignment): Assignment {
  const dueRaw = assignment.dueDate;
  const due =
    dueRaw.length >= 10 ? dueRaw.slice(0, 10) : new Date(dueRaw).toISOString().slice(0, 10);

  const nowIso = new Date().toISOString();
  return {
    id: assignment.id,
    patientId: assignment.patientId,
    doctorId: "doctor-1",
    gameId: assignment.gameId,
    gameName: assignment.name,
    difficulty: assignment.config.difficulty,
    reps: null,
    rounds: null,
    frequency: assignment.config.frequency,
    dueDate: due,
    targetSkill: assignment.config.targetSkills.join(", ") || assignment.gameId,
    notes: assignment.doctorInstructions,
    status: "assigned",
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

export async function saveCalibration(
  patientId: string,
  data: { open: FingerBends; closed: FingerBends }
): Promise<CalibrationPayload> {
  return apiFetch("/api/calibration", {
    method: "POST",
    body: JSON.stringify({ patientId, ...data })
  });
}

export async function fetchCalibration(patientId: string): Promise<CalibrationPayload> {
  return apiFetch(`/api/calibration/${patientId}`);
}

export async function savePatientSessionResult(
  result: SessionResult,
  assignment: PatientCareAssignment,
  backendConnected: boolean
): Promise<{ result: SessionResult; backendSaved: boolean }> {
  let backendSaved = false;

  if (backendConnected) {
    try {
      const exerciseBase = assignmentToExerciseTemplate(assignment);
      const exercise = { ...exerciseBase, id: assignment.gameId };
      const clinicAssignment = patientCareToAssignmentStub(assignment);
      const backendSession = await startBackendSession(
        result.patientId,
        exercise,
        clinicAssignment,
        {
          painBefore: result.painBefore.pain,
          fatigueBefore: result.painBefore.fatigue,
          inputMode: "demo",
          notes: `${assignment.name} · patient rehab game (${assignment.gameId})`
        }
      );

      await uploadPatientSessionGestures(backendSession.id, result.patientId, result.events);

      const roundedTime = Math.max(1, Math.round(result.timeTakenSeconds));
      await endBackendSession(backendSession.id, {
        notes: `${result.gameName} patient game. ${result.encouragement} Pain ${result.painBefore.pain}->${result.painAfter.pain}, fatigue ${result.painBefore.fatigue}->${result.painAfter.fatigue}.`,
        repsCompleted: result.repsCompleted,
        successfulReps: result.successfulReps,
        bestAccuracy: result.accuracy,
        averageAccuracy: result.accuracy,
        holdTimeMs: Math.round((result.timeTakenSeconds * 1000) / Math.max(result.successfulReps, 1)),
        smoothness: result.accuracy,
        failedAttempts: result.failedAttempts,
        accuracy: result.accuracy,
        timeTaken: roundedTime,
        painAfter: result.painAfter.pain,
        fatigueAfter: result.painAfter.fatigue,
        weakestFinger: result.weakestFinger,
        exerciseResultMetadata: {
          source: "patient-portal-game",
          gameId: result.gameId,
          assignmentId: result.assignmentId,
          encouragement: result.encouragement,
          calibrationId: result.calibration?.id
        }
      });

      backendSaved = true;
      const aligned: SessionResult = { ...result, id: backendSession.id };
      return {
        result: saveSessionResultLocal(aligned),
        backendSaved
      };
    } catch {
      backendSaved = false;
    }
  }

  return {
    result: saveSessionResultLocal(result),
    backendSaved
  };
}
