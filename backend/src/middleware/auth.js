const jwt = require("jsonwebtoken");
const { config } = require("../config");

async function verifyWithSupabaseAuth(token) {
  if (!config.supabaseUrl) {
    throw new Error("SUPABASE_URL is not configured");
  }

  const apiKey = config.supabaseServiceRoleKey || config.supabaseAnonKey;
  if (!apiKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is not configured");
  }

  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase Auth rejected token: ${response.status}`);
  }

  const user = await response.json();
  if (!user?.id) {
    throw new Error("Supabase Auth response did not include a user id");
  }

  return {
    id: user.id,
    email: user.email,
    role: user.user_metadata?.role || user.app_metadata?.role
  };
}

async function requireAuth(req, res, next) {
  if (config.storageMode !== "postgres") {
    req.user = { id: "mock-therapist", email: "therapist@demo.local" };
    return next();
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (config.supabaseJwtSecret) {
    try {
      const payload = jwt.verify(token, config.supabaseJwtSecret);
      req.user = { id: payload.sub, email: payload.email, role: payload.user_role || payload.role };
      return next();
    } catch {
      // Newer Supabase projects may use asymmetric signing keys; fall through to Auth API verification.
    }
  }

  try {
    req.user = await verifyWithSupabaseAuth(token);
    return next();
  } catch (error) {
    if (config.nodeEnv !== "production") {
      console.warn("[auth] rejected bearer token:", error.message);
    }
    return res.status(401).json({ error: "Unauthorized" });
  }
}

module.exports = { requireAuth };
