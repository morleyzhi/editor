import express from "express";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
const sessions = new Map();
const cookieName = "editor_session";
export function createApp({ upstream = fetch } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    next();
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const origin = req.headers.origin;
    const allowed =
      process.env.EDITOR_ORIGIN ||
      `http://127.0.0.1:${process.env.NODE_ENV === "production" ? process.env.PORT || 5173 : 5173}`;
    if (
      req.headers["sec-fetch-site"] === "cross-site" ||
      (origin && origin !== allowed) ||
      (!["GET", "HEAD"].includes(req.method) && origin !== allowed)
    )
      return res
        .status(403)
        .json({ error: "This request must come from the editor." });
    if (!["GET", "HEAD"].includes(req.method) && !req.is("application/json"))
      return res.status(415).json({ error: "JSON required." });
    next();
  });
  app.use(express.json({ limit: "8mb" }));
  app.use("/api", (req, res, next) => {
    let token = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    let session = sessions.get(token);
    if (!session || session.expires < Date.now()) {
      if (token) sessions.delete(token);
      token = randomBytes(32).toString("hex");
      session = { key: "", expires: Date.now() + 86400000, busy: false };
      sessions.set(token, session);
      res.cookie(cookieName, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: allowedHttps(),
        path: "/api",
        maxAge: 86400000,
      });
    }
    req.editorSession = session;
    next();
  });
  app.get("/api/settings", (req, res) =>
    res.json({ hasKey: !!req.editorSession.key }),
  );
  app.put("/api/settings", (req, res) => {
    if (
      typeof req.body.key !== "string" ||
      req.body.key.length > 1024 ||
      /[\r\n]/.test(req.body.key)
    )
      return res.status(400).json({ error: "Enter a valid API key." });
    req.editorSession.key = req.body.key.trim();
    res.json({ hasKey: !!req.editorSession.key });
  });
  app.post("/api/pass", async (req, res) => {
    const session = req.editorSession;
    if (!session.key)
      return res
        .status(401)
        .json({ error: "Add your Jev key in Settings first." });
    if (session.busy)
      return res
        .status(429)
        .json({
          error: "A request is already running. Wait for it to finish.",
        });
    const { state, questions } = req.body;
    if (
      typeof state?.document !== "string" ||
      !questions ||
      Object.keys(questions).length > 64 ||
      !Object.values(questions).every((q) => q.type === "noul")
    )
      return res.status(400).json({ error: "Invalid editing request." });
    session.busy = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    res.on("close", () => controller.abort());
    try {
      const response = await upstream("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.key}`,
        },
        body: JSON.stringify({ model: "jev-latest", state, questions }),
        signal: controller.signal,
      });
      if (!response.ok)
        return res
          .status(response.status === 401 ? 401 : 502)
          .json({
            error:
              response.status === 401
                ? "Jev rejected this key. Update it in Settings."
                : `Jev returned HTTP ${response.status}. Try again shortly.`,
          });
      const body = await response.json();
      res.json({ answers: body.answers });
    } catch {
      if (!res.destroyed)
        res
          .status(502)
          .json({
            error:
              "Jev could not finish the request. Check your connection and try again.",
          });
    } finally {
      clearTimeout(timeout);
      session.busy = false;
    }
  });
  app.use(express.static(fileURLToPath(new URL("../dist", import.meta.url))));
  app.use((err, req, res, next) =>
    res
      .status(err.status || 500)
      .json({
        error:
          err.status === 413
            ? "This piece exceeds the 8 MB request limit."
            : "The request could not be processed.",
      }),
  );
  return app;
}
function allowedHttps() {
  return process.env.EDITOR_ORIGIN?.startsWith("https:") || false;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  createApp().listen(Number(process.env.PORT || 5173), "127.0.0.1", () =>
    console.log(`Editor: http://127.0.0.1:${process.env.PORT || 5173}`),
  );
setInterval(() => {
  for (const [id, s] of sessions)
    if (s.expires < Date.now()) sessions.delete(id);
}, 60000).unref();
