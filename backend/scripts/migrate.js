const fs = require("fs");
const path = require("path");
const { pool } = require("../src/db/pool");

async function main() {
  const schemaPath = path.join(__dirname, "../src/db/schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  await pool.query(schema);
  console.log("Database schema is up to date.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
