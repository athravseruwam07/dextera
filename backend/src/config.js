require("dotenv").config();

const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || "postgres://gloving:gloving@localhost:55432/gloving",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  storageMode: process.env.STORAGE_MODE || "mock",
  nodeEnv: process.env.NODE_ENV || "development",
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash"
};

module.exports = { config };
