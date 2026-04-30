require("dotenv").config();

const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || "postgres://gloving:gloving@localhost:55432/gloving",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  storageMode: process.env.STORAGE_MODE || "mock",
  nodeEnv: process.env.NODE_ENV || "development",
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET || "",
  supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ""
};

module.exports = { config };
