const { pool } = require("../src/db/pool");

async function main() {
  const therapist = await pool.query(
    `
      INSERT INTO therapists (email, name)
      VALUES ('therapist@example.com', 'Demo Therapist')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `
  );

  await pool.query(
    `
      INSERT INTO patients (id, therapist_id, display_name, dominant_hand, notes)
      VALUES ('demo-patient-1', $1, 'Demo Patient', 'right', 'Seed patient for glove and dashboard testing.')
      ON CONFLICT (id) DO UPDATE
      SET therapist_id = EXCLUDED.therapist_id,
          display_name = EXCLUDED.display_name,
          dominant_hand = EXCLUDED.dominant_hand,
          notes = EXCLUDED.notes,
          updated_at = now()
    `,
    [therapist.rows[0].id]
  );

  await pool.query(
    `
      INSERT INTO exercises (name, description, target_gesture, difficulty, config)
      VALUES
        (
          'Ball Pickup Exercise',
          'Grab virtual balls with fist and release into the basket with open hand.',
          'fist',
          1,
          '{"targetReps": 10, "controls": "mouse-position-and-glove-gesture"}'::jsonb
        ),
        (
          'Point Select Drill',
          'Practice index extension and object selection.',
          'point',
          2,
          '{"targetReps": 8}'::jsonb
        )
      ON CONFLICT DO NOTHING
    `
  );

  console.log("Seed data inserted.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
