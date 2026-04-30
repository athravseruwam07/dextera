const { GoogleGenAI } = require("@google/genai");
const { config } = require("./config");

const ai = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;
const modelFallbacks = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash-lite"];

const gameTutorials = {
  "ball-pickup": {
    title: "Ball Pickup",
    steps: [
      "Open your hand to relax before the rep.",
      "Move your hand above the ball.",
      "Make a fist to grab the ball.",
      "Move your hand to the basket.",
      "Open your hand to release the ball into the basket."
    ]
  },
  "finger-tap-piano": {
    title: "Finger Tap Piano",
    steps: [
      "Tap or bend only the highlighted finger.",
      "Follow the timing cue.",
      "Keep the other fingers relaxed.",
      "Wrong taps count as misses."
    ]
  },
  "bubble-pop": {
    title: "Bubble Pop",
    steps: [
      "Move your hand marker to a bubble.",
      "Point or pinch to pop the target bubble.",
      "Avoid red decoys.",
      "Pop the assigned number before time runs out."
    ]
  },
  "carrom-flick": {
    title: "Carrom",
    steps: [
      "Aim the striker from the baseline.",
      "Use a controlled finger flick to launch it.",
      "Pocket your white coins before the AI pockets black.",
      "Watch the queen and control direction and force."
    ]
  }
};

function fallbackPatientReply(message = "", assignments = [], results = [], patient = {}) {
  const lower = message.toLowerCase();
  const medicalKeywords = [
    "diagnose",
    "diagnosis",
    "treatment",
    "medicine",
    "medication",
    "swelling",
    "numb",
    "emergency",
    "pain",
    "injury",
    "worse"
  ];

  if (medicalKeywords.some((keyword) => lower.includes(keyword))) {
    return "I cannot diagnose symptoms or give treatment advice. Stop the exercise if needed, contact your clinician for medical concerns, and seek urgent care for severe or sudden symptoms.";
  }

  if (lower.includes("how") || lower.includes("play")) {
    const knownGame = Object.entries(gameTutorials).find(([gameId, tutorial]) => {
      const title = tutorial.title.toLowerCase();
      return lower.includes(title) || lower.includes(gameId.replace(/-/g, " "));
    });
    if (knownGame) {
      const tutorial = knownGame[1];
      return `${tutorial.title}: ${tutorial.steps.join(" ")}`;
    }

    const assignedGame = assignments.find((assignment) =>
      lower.includes(String(assignment.name || "").toLowerCase().split(" ")[0])
    );
    const tutorial = assignedGame ? gameTutorials[assignedGame.gameId] : undefined;
    if (tutorial) return `${tutorial.title}: ${tutorial.steps.join(" ")}`;
  }

  if (lower.includes("rep") || lower.includes("left") || lower.includes("remaining") || lower.includes("today")) {
    if (!assignments.length) {
      return "I do not see assigned reps in this context yet. Check your rehab plan or ask your clinician to confirm today's exercises.";
    }

    const completedToday = new Set(
      results
        .filter((result) => new Date(result.startedAt).toDateString() === new Date().toDateString())
        .map((result) => result.assignmentId)
    );
    const repsLeft = assignments
      .filter((assignment) => !completedToday.has(assignment.id))
      .reduce((sum, assignment) => sum + Number(assignment.config?.targetReps || 0), 0);
    return `You have about ${repsLeft} assigned reps left today. Move slowly and rest between games.`;
  }

  if (lower.includes("assigned") || lower.includes("exercise") || lower.includes("game")) {
    const names = assignments.map((assignment) => assignment.name).filter(Boolean);
    return names.length
      ? `Today you have ${names.join(", ")}. Start with a short, careful session.`
      : "I do not see assigned games in this context yet.";
  }

  if (lower.includes("score") || lower.includes("accuracy") || lower.includes("result")) {
    const latest = results[0];
    return latest
      ? `Your latest saved result is ${latest.gameName} with ${latest.accuracy}% accuracy and ${latest.repsCompleted} completed reps. Accuracy estimates how closely your gestures matched the target movement.`
      : "Accuracy estimates how closely your gestures matched the target movement. I do not see a saved game result in this context yet.";
  }

  if (lower.includes("note") || lower.includes("doctor") || lower.includes("doc") || lower.includes("clinician")) {
    const notes = [
      patient.notes,
      ...assignments.flatMap((assignment) => [assignment.doctorNotes, assignment.doctorInstructions])
    ].filter(Boolean);
    return notes.length ? notes.join(" ") : "I do not see clinician notes in this context yet.";
  }

  if (lower.includes("motivat") || lower.includes("encourage") || lower.includes("tired") || lower.includes("hard")) {
    return "A short, careful session still counts. Focus on one smooth rep at a time, take breaks when your hand feels tired, and stop if pain rises sharply.";
  }

  return "I can help explain your assigned games, reps, scores, and clinician notes. I cannot diagnose symptoms or change your care plan.";
}

function isCompleteAssistantText(text = "") {
  const trimmed = text.trim();
  return trimmed.length >= 20 && /[.!?)]$/.test(trimmed);
}

function shouldAnswerFromDexteraData(message = "") {
  const lower = message.toLowerCase();
  return [
    "diagnose",
    "diagnosis",
    "treatment",
    "medicine",
    "medication",
    "swelling",
    "numb",
    "emergency",
    "pain",
    "injury",
    "worse",
    "how",
    "play",
    "rep",
    "left",
    "remaining",
    "today",
    "assigned",
    "exercise",
    "game",
    "note",
    "doctor",
    "doc",
    "clinician",
    "score",
    "accuracy",
    "result",
    "motivat",
    "encourage",
    "tired",
    "hard"
  ].some((keyword) => lower.includes(keyword));
}

function compactAssignments(assignments = []) {
  return assignments.slice(0, 8).map((assignment) => ({
    name: assignment.name,
    gameId: assignment.gameId,
    targetReps: assignment.config?.targetReps,
    difficulty: assignment.config?.difficulty,
    frequency: assignment.config?.frequency,
    doctorNotes: assignment.doctorNotes
  }));
}

function compactResults(results = []) {
  return results.slice(0, 6).map((result) => ({
    gameName: result.gameName,
    repsCompleted: result.repsCompleted,
    accuracy: result.accuracy,
    startedAt: result.startedAt,
    weakestFinger: result.weakestFinger,
    painBefore: result.painBefore,
    painAfter: result.painAfter,
    fatigueBefore: result.fatigueBefore,
    fatigueAfter: result.fatigueAfter
  }));
}

function compactPatient(patient = {}) {
  return {
    id: patient.id,
    name: patient.name,
    condition: patient.condition || patient.diagnosis,
    recoveryGoal: patient.recoveryGoal || patient.goal,
    affectedHand: patient.affectedHand,
    therapist: patient.therapist,
    notes: patient.notes
  };
}

async function createPatientAssistantReply({ patient, assignments, results, message, experienceMode }) {
  const trimmedMessage = String(message || "").trim().slice(0, 1200);
  if (!trimmedMessage) {
    return {
      message: "Ask me about your games, reps, scores, or clinician notes.",
      source: "fallback",
      configured: Boolean(ai)
    };
  }

  if (!ai) {
    return {
      message: fallbackPatientReply(trimmedMessage, assignments, results, patient),
      source: "fallback",
      configured: false
    };
  }

  if (shouldAnswerFromDexteraData(trimmedMessage)) {
    return {
      message: fallbackPatientReply(trimmedMessage, assignments, results, patient),
      source: "dextera",
      configured: true
    };
  }

  const systemInstruction = `You are Dextera's patient rehabilitation assistant.

Dextera is a hand-therapy platform with assigned rehab games, smart glove input, scores, reps, clinician notes, and progress tracking.

Audience mode: ${experienceMode === "doctor-library" ? "clinician preview library" : "patient portal"}.

Safety and scope:
- Do not diagnose symptoms.
- Do not recommend medication.
- Do not change the patient's treatment plan, assignments, reps, or difficulty.
- If the user mentions severe pain, new numbness, swelling, worsening symptoms, injury, or emergency concerns, tell them to stop exercising and contact their clinician or urgent care.
- Do not claim to be a doctor.
- Keep replies calm, concise, and easy to read.
- Complete every sentence. Prefer 2 to 4 short sentences.
- Use the provided context only. If context is missing, say what you can explain generally.

Patient context:
${JSON.stringify(compactPatient(patient))}

Assigned games:
${JSON.stringify(compactAssignments(assignments))}

Recent results:
${JSON.stringify(compactResults(results))}`;

  const modelCandidates = Array.from(new Set([config.geminiModel, ...modelFallbacks].filter(Boolean)));
  let lastError;

  for (const model of modelCandidates) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: trimmedMessage,
        config: {
          temperature: 0.35,
          maxOutputTokens: 500,
          systemInstruction
        }
      });
      const text = response.text || "";

      return {
        message: isCompleteAssistantText(text)
          ? text
          : fallbackPatientReply(trimmedMessage, assignments, results, patient),
        source: isCompleteAssistantText(text) ? "gemini" : "fallback",
        configured: true,
        model
      };
    } catch (error) {
      lastError = error;
      const status = error?.status || error?.code;
      if (status !== 404) break;
    }
  }

  return {
    message: fallbackPatientReply(trimmedMessage, assignments, results, patient),
    source: "fallback",
    configured: true,
    error: lastError?.status || lastError?.code || "gemini_request_failed"
  };
}

module.exports = { createPatientAssistantReply };
