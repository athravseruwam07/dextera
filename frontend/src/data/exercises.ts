import type { FingerName } from "../types";

export type ExerciseDifficulty = "easy" | "medium" | "hard";
export type ExerciseCategory = "single" | "two-finger" | "three-finger" | "four-finger";

export interface FingerExercise {
  id: string;
  name: string;
  description: string;
  fingers: FingerName[];
  difficulty: ExerciseDifficulty;
  reps: number;
  category: ExerciseCategory;
}

export interface ExerciseAssignment {
  id: string;
  patientId: string;
  exerciseId: string;
  assignedAt: string;
}

export const fingerExercises: FingerExercise[] = [
  {
    id: "ex-thumb",
    name: "Thumb tap",
    description: "Press and release thumb only.",
    fingers: ["thumb"],
    difficulty: "easy",
    reps: 10,
    category: "single"
  },
  {
    id: "ex-index",
    name: "Index tap",
    description: "Press and release index finger only.",
    fingers: ["index"],
    difficulty: "easy",
    reps: 10,
    category: "single"
  },
  {
    id: "ex-middle",
    name: "Middle tap",
    description: "Press and release middle finger only.",
    fingers: ["middle"],
    difficulty: "easy",
    reps: 10,
    category: "single"
  },
  {
    id: "ex-ring",
    name: "Ring tap",
    description: "Press and release ring finger only.",
    fingers: ["ring"],
    difficulty: "medium",
    reps: 10,
    category: "single"
  },
  {
    id: "ex-pinky",
    name: "Pinky tap",
    description: "Press and release pinky only.",
    fingers: ["pinky"],
    difficulty: "medium",
    reps: 10,
    category: "single"
  },
  {
    id: "ex-pinch",
    name: "Pinch",
    description: "Touch thumb and index together.",
    fingers: ["thumb", "index"],
    difficulty: "easy",
    reps: 10,
    category: "two-finger"
  },
  {
    id: "ex-thumb-middle",
    name: "Thumb + middle",
    description: "Touch thumb to middle finger.",
    fingers: ["thumb", "middle"],
    difficulty: "medium",
    reps: 10,
    category: "two-finger"
  },
  {
    id: "ex-thumb-ring",
    name: "Thumb + ring",
    description: "Touch thumb to ring finger.",
    fingers: ["thumb", "ring"],
    difficulty: "medium",
    reps: 10,
    category: "two-finger"
  },
  {
    id: "ex-thumb-pinky",
    name: "Thumb + pinky",
    description: "Touch thumb to pinky.",
    fingers: ["thumb", "pinky"],
    difficulty: "hard",
    reps: 10,
    category: "two-finger"
  },
  {
    id: "ex-index-middle",
    name: "Index + middle",
    description: "Bend index and middle together while the other fingers stay extended.",
    fingers: ["index", "middle"],
    difficulty: "medium",
    reps: 8,
    category: "two-finger"
  },
  {
    id: "ex-three-imr",
    name: "Index + middle + ring",
    description: "Bend index, middle, and ring together.",
    fingers: ["index", "middle", "ring"],
    difficulty: "hard",
    reps: 8,
    category: "three-finger"
  },
  {
    id: "ex-three-mrp",
    name: "Middle + ring + pinky",
    description: "Bend middle, ring, and pinky together.",
    fingers: ["middle", "ring", "pinky"],
    difficulty: "hard",
    reps: 8,
    category: "three-finger"
  },
  {
    id: "ex-three-tim",
    name: "Three-finger pinch",
    description: "Bring thumb, index, and middle together.",
    fingers: ["thumb", "index", "middle"],
    difficulty: "medium",
    reps: 8,
    category: "three-finger"
  },
  {
    id: "ex-four-imrp",
    name: "Four-finger curl",
    description: "Bend index, middle, ring, and pinky together while the thumb stays relaxed.",
    fingers: ["index", "middle", "ring", "pinky"],
    difficulty: "hard",
    reps: 6,
    category: "four-finger"
  },
  {
    id: "ex-four-timr",
    name: "Thumb + index + middle + ring",
    description: "Bend all but pinky.",
    fingers: ["thumb", "index", "middle", "ring"],
    difficulty: "hard",
    reps: 6,
    category: "four-finger"
  }
];

export const exerciseCategories: Array<{ id: ExerciseCategory; label: string }> = [
  { id: "single", label: "Single finger" },
  { id: "two-finger", label: "2-finger combos" },
  { id: "three-finger", label: "3-finger combos" },
  { id: "four-finger", label: "4-finger combos" }
];
