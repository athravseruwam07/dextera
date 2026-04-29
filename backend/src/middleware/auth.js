const jwt = require("jsonwebtoken");
const { config } = require("../config");

function requireAuth(req, res, next) {
  if (config.storageMode !== "postgres") {
    req.user = { id: "mock-therapist", email: "therapist@demo.local" };
    return next();
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, config.supabaseJwtSecret);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

module.exports = { requireAuth };
