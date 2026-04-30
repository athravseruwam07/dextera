import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  exerciseCategories,
  fingerExercises,
  type ExerciseAssignment,
  type ExerciseCategory,
  type FingerExercise
} from "../data/exercises";
import type { FingerName, Patient } from "../types";

const fingerLabel: Record<FingerName, string> = {
  thumb: "Thumb",
  index: "Index",
  middle: "Middle",
  ring: "Ring",
  pinky: "Pinky"
};

interface Props {
  patients: Patient[];
  assignments: ExerciseAssignment[];
  onAssign: (patientId: string, exerciseId: string) => void;
  onUnassign: (assignmentId: string) => void;
}

export function ExercisesPage({ patients, assignments, onAssign, onUnassign }: Props) {
  const [selectedPatientId, setSelectedPatientId] = useState(patients[0]?.id ?? "");
  const [categoryFilter, setCategoryFilter] = useState<ExerciseCategory | "all">("all");

  const filteredExercises = useMemo(
    () => (categoryFilter === "all" ? fingerExercises : fingerExercises.filter((exercise) => exercise.category === categoryFilter)),
    [categoryFilter]
  );

  const patientAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.patientId === selectedPatientId),
    [assignments, selectedPatientId]
  );

  const selectedPatientName = patients.find((patient) => patient.id === selectedPatientId)?.name ?? "patient";

  const assignedExercise = (exerciseId: string) =>
    patientAssignments.find((assignment) => assignment.exerciseId === exerciseId);

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Therapy library</span>
          <h2>Basic exercises</h2>
          <p>Assign focused finger isolation and combination drills to a patient portal.</p>
        </div>
      </div>

      <article className="surface exercises-controls">
        <div className="exercises-control-row">
          <label>
            <span className="eyebrow">Patient</span>
            <select value={selectedPatientId} onChange={(event) => setSelectedPatientId(event.target.value)}>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="eyebrow">Category</span>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value as ExerciseCategory | "all")}
            >
              <option value="all">All categories</option>
              {exerciseCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </article>

      <div className="exercise-grid">
        {filteredExercises.map((exercise) => {
          const assigned = assignedExercise(exercise.id);
          return (
            <ExerciseCard
              key={exercise.id}
              exercise={exercise}
              assigned={Boolean(assigned)}
              onAssign={() => onAssign(selectedPatientId, exercise.id)}
              onUnassign={() => assigned && onUnassign(assigned.id)}
              disabled={!selectedPatientId}
            />
          );
        })}
      </div>

      {patientAssignments.length > 0 ? (
        <article className="surface">
          <div className="section-title">
            <h3>Assigned to {selectedPatientName}</h3>
            <span>{patientAssignments.length} exercises</span>
          </div>
          <div className="stack-list">
            {patientAssignments.map((assignment) => {
              const exercise = fingerExercises.find((item) => item.id === assignment.exerciseId);
              if (!exercise) return null;
              return (
                <div key={assignment.id} className="list-card exercise-assigned-row">
                  <div>
                    <strong>{exercise.name}</strong>
                    <p>
                      {exercise.reps} reps · {exercise.difficulty}
                    </p>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => onUnassign(assignment.id)}>
                    <Trash2 size={14} />
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        </article>
      ) : null}
    </section>
  );
}

function ExerciseCard({
  exercise,
  assigned,
  disabled,
  onAssign,
  onUnassign
}: {
  exercise: FingerExercise;
  assigned: boolean;
  disabled: boolean;
  onAssign: () => void;
  onUnassign: () => void;
}) {
  return (
    <article className="surface exercise-card">
      <div className="section-title">
        <h3>{exercise.name}</h3>
        <span className={`status-pill difficulty-${exercise.difficulty}`}>{exercise.difficulty}</span>
      </div>
      <p className="exercise-desc">{exercise.description}</p>
      <div className="exercise-meta">
        <span className="exercise-meta-item">{exercise.reps} reps</span>
        <span className="exercise-meta-item">{exercise.fingers.map((finger) => fingerLabel[finger]).join(" + ")}</span>
      </div>
      {assigned ? (
        <button className="secondary-button" type="button" onClick={onUnassign}>
          <Trash2 size={14} />
          Unassign
        </button>
      ) : (
        <button className="primary-button" type="button" onClick={onAssign} disabled={disabled}>
          <Plus size={14} />
          Assign
        </button>
      )}
    </article>
  );
}
