import type { Express } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import { storage } from "./storage";
import { generateResponse, generateStreamingResponse, analyzeScreen, analyzeScreenStream, analyzeMultiScreenStream, getAvailableModels } from "./openai";
import { detectQuestion, detectQuestionAdvanced, frameQuestionWindow, normalizeForDedup, isSubstantiveSegment } from "@shared/questionDetection";
import { invalidateSettingsCache, getPrewarmedOpenAIKey, prewarmApiKey, FAST_MODEL, keepAliveAgent, resolveLLMConfig } from "./llmRouter";
import { resolveAutomaticInterviewModel } from "./llmRouter2";
import { streamOpenAIFast } from "./llmStream";
import { getMaxTokensForFormat, buildSystemPrompt } from "./prompt";
import { formatMemorySlotsForPrompt, processPostAnswerMemory } from "./memoryExtractor";
import session from "express-session";
import { pool } from "./db";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcrypt";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { db } from "./db";
import { sql } from "drizzle-orm";
import multer from "multer";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { mintAzureToken, getAzureStatus } from "./speech/azureToken";
import { encryptSettingValue, decryptSettingValue } from "./settingsCrypto";
import { runDetectionPipeline, extractQuestionsWithLLM, composeQuestionWithLLM, normalizeQuestion, isDuplicateQuestion } from "./assist/questionDetect";
import { streamAssistantAnswer } from "./assist/answerStream";
import { orchestrate } from "./assist/orchestrator";
import { getState as getMeetingState, getRecentFinals, setAnswerStyle, getAnswerStyle, setCodeContext, enqueueQuestion } from "./realtime/meetingStore";
import { recordInterviewerQuestion, recordSpokenReply, getCodingProblemState } from "./assist/sessionState";
import { getStructuredInterviewAnswer } from "./assist/structuredAnswer";
import { indexDocumentForRag, retrieveDocumentContext } from "./rag";
import { getOrLoadConversationSummary, getOrLoadDocRetrieval, getOrLoadSettings } from "./cache/hotPathCache";
import { generateSessionReview } from "./sessionReview";
import { getUseCaseConfigWithScope } from "./llmRouter2";

const upload = multer({ dest: "/tmp/audio-uploads/", limits: { fileSize: 25 * 1024 * 1024 } });
const docUpload = multer({ dest: "/tmp/doc-uploads/", limits: { fileSize: 20 * 1024 * 1024 } });
const MINUTE_PACKS = [
  { id: "minutes-10", minutes: 10, amountCents: 249, label: "10 Minutes" },
  { id: "minutes-30", minutes: 30, amountCents: 599, label: "30 Minutes" },
  { id: "minutes-60", minutes: 60, amountCents: 1199, label: "60 Minutes" },
] as const;

function resolveMinutePurchase(minutesRequested: number) {
  if (!Number.isFinite(minutesRequested) || minutesRequested <= 0 || minutesRequested % 10 !== 0) {
    return null;
  }

  const dp = new Array<number>(minutesRequested + 1).fill(Number.POSITIVE_INFINITY);
  const choice = new Array<number>(minutesRequested + 1).fill(-1);
  dp[0] = 0;

  for (let total = 10; total <= minutesRequested; total += 10) {
    for (let i = 0; i < MINUTE_PACKS.length; i++) {
      const pack = MINUTE_PACKS[i];
      if (total >= pack.minutes && dp[total - pack.minutes] + pack.amountCents < dp[total]) {
        dp[total] = dp[total - pack.minutes] + pack.amountCents;
        choice[total] = i;
      }
    }
  }

  if (!Number.isFinite(dp[minutesRequested])) {
    return null;
  }

  const packCounts: Record<string, number> = {};
  let cursor = minutesRequested;
  while (cursor > 0) {
    const idx = choice[cursor];
    if (idx < 0) break;
    const pack = MINUTE_PACKS[idx];
    packCounts[pack.id] = (packCounts[pack.id] || 0) + 1;
    cursor -= pack.minutes;
  }

  return {
    minutes: minutesRequested,
    amountCents: dp[minutesRequested],
    label: `${minutesRequested} Minutes`,
    packCounts,
  };
}

const SALT_ROUNDS = 10;

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  try {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS first_name text,
      ADD COLUMN IF NOT EXISTS last_name text,
      ADD COLUMN IF NOT EXISTS google_id text UNIQUE
    `);
  } catch (error: any) {
    console.error("[startup] Failed to ensure user profile columns:", error?.message || error);
  }

  const PgSession = connectPgSimple(session);

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET environment variable must be set");
  }

  app.set("trust proxy", 1);

  const isProduction = process.env.NODE_ENV === "production";
  const forceInsecureCookies = process.env.COOKIE_SECURE === "false";

  app.use(
    session({
      store: new PgSession({
        pool,
        createTableIfMissing: true,
        pruneSessionInterval: 60 * 15,
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      proxy: isProduction,
      cookie: {
        secure: isProduction && !forceInsecureCookies ? "auto" as any : false,
        httpOnly: true,
        // "none" is required for cross-origin requests from the Tauri desktop
        // WebView (https://tauri.localhost → https://ai.zoommate.in).
        // "none" requires secure:true (HTTPS), which is satisfied in production.
        sameSite: isProduction && !forceInsecureCookies ? "none" : "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    })
  );

  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { username, password, email } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ message: "Username already taken" });
      }
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      const user = await storage.createUser({ username, password: hashedPassword, email });
      (req.session as any).userId = user.id;
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ message: "Account created but session failed. Please log in." });
        }
        res.json({ id: user.id, username: user.username, role: user.role });
        });
    } catch (error: any) {
      console.error("Signup error:", error);
      res.status(500).json({ message: error?.message || "An error occurred during signup. Please try again." });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
      }
      if (user.status === "banned") {
        return res.status(403).json({ message: "Your account has been suspended. Please contact support." });
      }
      if (user.status === "suspended") {
        return res.status(403).json({ message: "Your account is temporarily suspended. Please contact support." });
      }
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid username or password" });
      }
      await storage.updateUser(user.id, { lastLoginAt: new Date() });
      (req.session as any).userId = user.id;
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ message: "Failed to create session. Please try again." });
        }
        res.json({ id: user.id, username: user.username, role: user.role });
      });
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(500).json({ message: error?.message || "An error occurred during login. Please try again." });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ message: "Logged out" });
    });
  });

  // ── Google OAuth ────────────────────────────────────────────────────────────
  app.get("/auth/google", (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return res.status(503).send("Google Sign-In is not configured (missing GOOGLE_CLIENT_ID).");
    }
    const redirectUri = `${process.env.APP_URL || `${req.protocol}://${req.get("host")}`}/auth/google/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get("/auth/google/callback", async (req, res) => {
    const { code } = req.query as { code?: string };
    if (!code) {
      return res.redirect("/login?error=google_no_code");
    }
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID!;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
      const redirectUri = `${process.env.APP_URL || `${req.protocol}://${req.get("host")}`}/auth/google/callback`;

      // Exchange code for tokens
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) {
        console.error("[GoogleOAuth] token exchange failed:", await tokenRes.text());
        return res.redirect("/login?error=google_token_failed");
      }
      const tokenData = await tokenRes.json() as { access_token: string };

      // Fetch Google user profile
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!profileRes.ok) {
        console.error("[GoogleOAuth] profile fetch failed:", await profileRes.text());
        return res.redirect("/login?error=google_profile_failed");
      }
      const profile = await profileRes.json() as { id: string; email: string; name: string; given_name?: string; family_name?: string };

      // Find or create user
      let user = await storage.getUserByGoogleId(profile.id);
      if (!user) {
        // Try to find by email
        const existingByEmail = profile.email
          ? (await pool.query("SELECT * FROM users WHERE email = $1 LIMIT 1", [profile.email])).rows[0] as any
          : null;
        if (existingByEmail) {
          // Link Google ID to existing account
          user = await storage.updateUser(existingByEmail.id, { googleId: profile.id });
        } else {
          // Create new user (derive a unique username from email)
          const baseUsername = (profile.email?.split("@")[0] || "user").replace(/[^a-zA-Z0-9_]/g, "");
          let username = baseUsername;
          let attempt = 0;
          while (await storage.getUserByUsername(username)) {
            attempt++;
            username = `${baseUsername}${attempt}`;
          }
          user = await storage.createUser({
            username,
            password: "", // Google users have no password
            email: profile.email,
            googleId: profile.id,
            firstName: profile.given_name,
            lastName: profile.family_name,
          } as any);
        }
      }

      (req.session as any).userId = user.id;
      await storage.updateUser(user.id, { lastLoginAt: new Date() });
      req.session.save((err) => {
        if (err) {
          console.error("[GoogleOAuth] session save error:", err);
          return res.redirect("/login?error=session_failed");
        }
        res.redirect(user!.role === "admin" ? "/admin" : "/dashboard");
      });
    } catch (err: any) {
      console.error("[GoogleOAuth] callback error:", err);
      res.redirect("/login?error=google_auth_failed");
    }
  });
  // ────────────────────────────────────────────────────────────────────────────

  app.get("/api/auth/me", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      minutesUsed: user.minutesUsed,
      minutesPurchased: user.minutesPurchased,
      referralCredits: user.referralCredits,
      plan: user.plan,
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: user.stripeSubscriptionId,
    });
  });

  // ── Desktop OAuth flow ──────────────────────────────────────────────────────

  // In-memory store for desktop OAuth tokens (expires in 5 min)
  const desktopOAuthTokens = new Map<string, { userId: string; expiresAt: number }>();

  // Serve the OAuth authorize page
  app.get("/oauth/authorize", async (req, res) => {
    const { redirect_uri, state } = req.query as { redirect_uri?: string; state?: string };
    if (!redirect_uri || !state) return res.status(400).send("Missing redirect_uri or state");

    // Validate redirect_uri is localhost
    if (!redirect_uri.startsWith("http://127.0.0.1:")) {
      return res.status(400).send("Invalid redirect_uri");
    }

    const userId = (req.session as any)?.userId;
    let userEmail = "";
    if (userId) {
      const user = await storage.getUser(userId).catch(() => null);
      if (user) { userEmail = user.email || user.username; }
    }

    const encodedRedirect = encodeURIComponent(redirect_uri);
    const encodedState = encodeURIComponent(state);

    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Authorize — Zoommate</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .card { background: #fff; border-radius: 20px; padding: 40px; width: 100%; max-width: 480px; box-shadow: 0 24px 80px rgba(0,0,0,0.2); text-align: center; }
    .badge { display: inline-block; background: rgba(99,102,241,0.12); color: #4f46e5; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; padding: 4px 12px; border-radius: 99px; margin-bottom: 20px; text-transform: uppercase; }
    h1 { font-size: 26px; font-weight: 700; color: #111; margin-bottom: 10px; }
    .subtitle { color: #6b7280; font-size: 14px; line-height: 1.5; margin-bottom: 16px; }
    .user-line { font-size: 14px; color: #374151; margin-bottom: 28px; }
    .user-line strong { color: #111; }
    .not-signed-in { font-size: 13px; color: #9ca3af; margin-bottom: 28px; }
    .not-signed-in a { color: #4f46e5; text-decoration: none; }
    .not-signed-in a:hover { text-decoration: underline; }
    .btns { display: flex; gap: 12px; }
    .btn { flex: 1; padding: 14px; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; border: none; transition: opacity 0.15s; }
    .btn:hover { opacity: 0.88; }
    .btn-cancel { background: #f3f4f6; color: #374151; }
    .btn-auth { background: #4f46e5; color: #fff; }
    .footer { margin-top: 20px; font-size: 12px; color: #9ca3af; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Zoommate Desktop</div>
    <h1>Connect your Zoommate account</h1>
    <p class="subtitle">Give the desktop app permission to access your account.</p>
    ${userId
      ? `<p class="user-line">Signed in as <strong>${userEmail}</strong></p>`
      : `<p class="not-signed-in">You must <a href="/login?next=${encodeURIComponent(`/oauth/authorize?redirect_uri=${encodedRedirect}&state=${encodedState}`)}">sign in</a> first.</p>`
    }
    <form id="authForm" method="POST" action="/oauth/authorize/confirm">
      <input type="hidden" name="redirect_uri" value="${redirect_uri}" />
      <input type="hidden" name="state" value="${state}" />
      <div class="btns">
        <button type="button" class="btn btn-cancel" onclick="window.close()">Cancel</button>
        ${userId ? `<button type="submit" class="btn btn-auth">Authorize</button>` : ""}
      </div>
    </form>
    <p class="footer">You're authorizing the official Zoommate desktop app to sign in with your account.</p>
  </div>
</body>
</html>`);
  });

  // Handle the authorize form submission
  app.post("/oauth/authorize/confirm", async (req: any, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).send("Not authenticated");

    const { redirect_uri, state } = req.body as { redirect_uri?: string; state?: string };
    if (!redirect_uri || !state) return res.status(400).send("Missing params");
    if (!redirect_uri.startsWith("http://127.0.0.1:")) return res.status(400).send("Invalid redirect_uri");

    // Generate short-lived token
    const token = crypto.randomBytes(32).toString("hex");
    desktopOAuthTokens.set(token, { userId, expiresAt: Date.now() + 5 * 60 * 1000 });

    // Clean up expired tokens
    for (const [k, v] of desktopOAuthTokens.entries()) {
      if (v.expiresAt < Date.now()) desktopOAuthTokens.delete(k);
    }

    const params = new URLSearchParams({ token, state });
    res.redirect(`${redirect_uri}?${params.toString()}`);
  });

  // Exchange desktop token for session
  app.post("/api/auth/desktop-session", async (req, res) => {
    const { token } = req.body as { token?: string };
    if (!token) return res.status(400).json({ message: "token required" });

    const entry = desktopOAuthTokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
      desktopOAuthTokens.delete(token);
      return res.status(401).json({ message: "Token expired or invalid" });
    }
    desktopOAuthTokens.delete(token); // one-time use

    const user = await storage.getUser(entry.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    (req.session as any).userId = user.id;
    await new Promise<void>((resolve, reject) => req.session.save((err: any) => err ? reject(err) : resolve()));

    res.json({ id: user.id, username: user.username });
  });

  // ── End desktop OAuth flow ──────────────────────────────────────────────────

  const requireAuth = async (req: any, res: any, next: any) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Your session has expired. Please sign in again." });
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "Account not found. Please sign in again." });
    if (user.status === "banned" || user.status === "suspended") {
      return res.status(403).json({ message: "Your account has been suspended. Please contact support." });
    }
    req.userId = userId;
    next();
  };

  app.post("/api/auth/change-password", requireAuth, async (req: any, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current password and new password are required" });
      }
      if (String(newPassword).length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters" });
      }

      const user = await storage.getUser(req.userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const isValid = await bcrypt.compare(String(currentPassword), user.password);
      if (!isValid) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }

      const hashedPassword = await bcrypt.hash(String(newPassword), SALT_ROUNDS);
      await storage.updateUser(user.id, { password: hashedPassword });
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to change password" });
    }
  });

  app.patch("/api/auth/profile", requireAuth, async (req: any, res) => {
    try {
      const firstName = typeof req.body?.firstName === "string" ? req.body.firstName.trim() : "";
      const lastName = typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";
      const updated = await storage.updateUser(req.userId, {
        firstName: firstName || null as any,
        lastName: lastName || null as any,
      });
      res.json({
        id: updated.id,
        username: updated.username,
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update profile" });
    }
  });

  app.get("/api/account/credit-logs", requireAuth, async (req: any, res) => {
    try {
      const logs = await storage.getCreditLogs(req.userId);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to load credit history" });
    }
  });

  const requireAdmin = async (req: any, res: any, next: any) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const user = await storage.getUser(userId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    req.userId = userId;
    next();
  };

  const hasSpeechCredits = async (userId: string): Promise<boolean> => {
    const user = await storage.getUser(userId);
    if (!user) return false;
    return true; // All logged-in users get Azure STT
  };

  app.get("/api/documents", requireAuth, async (req: any, res) => {
    try {
      const docs = await storage.getDocuments(req.userId);
      res.json(docs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/documents", requireAuth, async (req: any, res) => {
    try {
      const { name, content, type } = req.body;
      if (!name || !content) {
        return res.status(400).json({ message: "Name and content are required" });
      }
      const doc = await storage.createDocument({
        userId: req.userId,
        name,
        content,
        type: type || "general",
      });
      void indexDocumentForRag(doc.id).catch((error) => {
        console.error("RAG indexing failed for pasted document:", error);
      });
      res.json(doc);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/documents/upload", requireAuth, (req: any, res) => {
    docUpload.single("file")(req, res, async (uploadError: any) => {
      if (uploadError) {
        return res.status(400).json({ message: uploadError.message || "Failed to upload file" });
      }

      try {
        const file = req.file;
        if (!file) {
          return res.status(400).json({ message: "No file uploaded" });
        }

        const ext = path.extname(file.originalname).toLowerCase();
        let extractedText = "";

        try {
          if (ext === ".pdf") {
            const pdfParseModule = await import("pdf-parse");
            const pdfParse = (pdfParseModule as any).default || pdfParseModule;
            const dataBuffer = fs.readFileSync(file.path);
            const data = await pdfParse(dataBuffer);
            extractedText = data.text || "";
          } else if (ext === ".docx") {
            const mammoth = await import("mammoth");
            const result = await mammoth.extractRawText({ path: file.path });
            extractedText = result.value || "";
          } else if (ext === ".doc") {
            const dataBuffer = fs.readFileSync(file.path);
            const decoded = new TextDecoder("utf-8", { fatal: false }).decode(dataBuffer);
            extractedText = decoded.replace(/[^\x20-\x7E\r\n\t]/g, " ").replace(/\s{3,}/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
          } else {
            extractedText = fs.readFileSync(file.path, "utf-8");
          }
        } finally {
          try { fs.unlinkSync(file.path); } catch (e) {}
        }

        if (!extractedText || extractedText.trim().length < 10) {
          return res.status(400).json({ message: "Could not extract text from this file. Try pasting the content directly." });
        }

        extractedText = extractedText.replace(/\r\n/g, "\n").replace(/\s+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();

        const docName = req.body?.name || file.originalname.replace(/\.[^.]+$/, "");
        const docType = req.body?.type || "general";

        const doc = await storage.createDocument({
          userId: req.userId,
          name: docName,
          content: extractedText,
          type: docType,
        });
        void indexDocumentForRag(doc.id).catch((error) => {
          console.error("RAG indexing failed for uploaded document:", error);
        });
        res.json(doc);
      } catch (error: any) {
        console.error("Document upload error:", error);
        res.status(500).json({ message: error.message || "Failed to process uploaded file" });
      }
    });
  });

  app.delete("/api/documents/:id", requireAuth, async (req: any, res) => {
    try {
      const doc = await storage.getDocument(req.params.id);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      if (doc.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });
      await storage.deleteDocument(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/meetings", requireAuth, async (req: any, res) => {
    try {
      const meetingsList = await storage.getMeetings(req.userId);
      res.json(meetingsList);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/assistants", requireAuth, async (req: any, res) => {
    try {
      const assistantsList = await storage.getAssistants(req.userId);
      res.json(assistantsList);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/assistants/:id", requireAuth, async (req: any, res) => {
    try {
      const assistant = await storage.getAssistant(req.params.id);
      if (!assistant) return res.status(404).json({ message: "Assistant not found" });
      if (assistant.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });
      res.json(assistant);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/assistants", requireAuth, async (req: any, res) => {
    try {
      const {
        name,
        copilotType,
        responseFormat,
        customInstructions,
        documentIds,
        model,
        sessionMode,
        interviewStyle,
      } = req.body;

      if (!name || !String(name).trim()) {
        return res.status(400).json({ message: "Name is required" });
      }

      const assistant = await storage.createAssistant({
        userId: req.userId,
        name: String(name).trim(),
        copilotType: typeof copilotType === "string" ? copilotType : "custom",
        responseFormat: typeof responseFormat === "string" ? responseFormat : "concise",
        customInstructions: typeof customInstructions === "string" ? customInstructions : undefined,
        documentIds: Array.isArray(documentIds) ? documentIds : [],
        model: typeof model === "string" && model ? model : "automatic",
        sessionMode: typeof sessionMode === "string" && sessionMode ? sessionMode : "interview",
        interviewStyle: interviewStyle && typeof interviewStyle === "object" ? interviewStyle : undefined,
      });

      res.json(assistant);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/assistants/:id", requireAuth, async (req: any, res) => {
    try {
      const assistant = await storage.getAssistant(req.params.id);
      if (!assistant) return res.status(404).json({ message: "Assistant not found" });
      if (assistant.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });

      const updateData: any = {};
      const {
        name,
        copilotType,
        responseFormat,
        customInstructions,
        documentIds,
        model,
        sessionMode,
        interviewStyle,
      } = req.body;

      if (typeof name === "string" && name.trim()) updateData.name = name.trim();
      if (typeof copilotType === "string" && copilotType) updateData.copilotType = copilotType;
      if (typeof responseFormat === "string" && responseFormat) updateData.responseFormat = responseFormat;
      if (typeof customInstructions === "string") updateData.customInstructions = customInstructions;
      if (Array.isArray(documentIds)) updateData.documentIds = documentIds;
      if (typeof model === "string" && model) updateData.model = model;
      if (typeof sessionMode === "string" && sessionMode) updateData.sessionMode = sessionMode;
      if (interviewStyle && typeof interviewStyle === "object") updateData.interviewStyle = interviewStyle;

      const updated = await storage.updateAssistant(req.params.id, updateData);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/assistants/:id", requireAuth, async (req: any, res) => {
    try {
      const assistant = await storage.getAssistant(req.params.id);
      if (!assistant) return res.status(404).json({ message: "Assistant not found" });
      if (assistant.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });
      await storage.deleteAssistant(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/assistants/:id/launch", requireAuth, async (req: any, res) => {
    try {
      const assistant = await storage.getAssistant(req.params.id);
      if (!assistant) return res.status(404).json({ message: "Assistant not found" });
      if (assistant.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });

      const meeting = await storage.createMeeting({
        userId: req.userId,
        title: assistant.name,
        type: assistant.copilotType,
        responseFormat: assistant.responseFormat,
        customInstructions: assistant.customInstructions || undefined,
        documentIds: assistant.documentIds || [],
        model: assistant.model || "automatic",
        sessionMode: assistant.sessionMode,
        interviewStyle: assistant.interviewStyle || undefined,
      });

      res.json(meeting);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/meetings/:id", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) return res.status(404).json({ message: "Meeting not found" });
      if (meeting.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });
      res.json(meeting);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/meetings", requireAuth, async (req: any, res) => {
    try {
      const { title, type, responseFormat, customInstructions, documentIds, model, sessionMode, interviewStyle, isPractice } = req.body;
      if (!title) {
        return res.status(400).json({ message: "Title is required" });
      }
      const validTypes = ["interview", "technical", "behavioral", "sales", "meeting", "trivia", "custom"];
      const validFormats = ["automatic", "concise", "detailed", "star", "bullet", "technical", "short", "custom"];
      const validModes = ["interview", "coding", "screenshare", "phone"];
      let selectedModel = model;
      if (!selectedModel || typeof selectedModel !== "string") {
        const defaultModel = await storage.getSetting("default_model");
        selectedModel = defaultModel || "gpt-4o";
      }
      const safeInterviewStyle = (interviewStyle && typeof interviewStyle === "object") ? interviewStyle : null;
      if (safeInterviewStyle?.quickInterview) {
        const targetRole = String(safeInterviewStyle.targetRole || "").trim();
        const years = Number(safeInterviewStyle.experienceYears);
        if (!targetRole) {
          return res.status(400).json({ message: "Target Role is required in Quick Interview mode" });
        }
        if (!Number.isFinite(years) || years < 0 || years > 60) {
          return res.status(400).json({ message: "Experience (Years) must be a valid number" });
        }
      }
      const meetingData: any = {
        userId: req.userId,
        title,
        type: validTypes.includes(type) ? type : "interview",
        responseFormat: validFormats.includes(responseFormat) ? responseFormat : "concise",
        customInstructions,
        documentIds: documentIds || [],
        model: selectedModel,
        sessionMode: validModes.includes(sessionMode) ? sessionMode : "interview",
        interviewStyle: safeInterviewStyle,
        isPractice: Boolean(isPractice),
      };
      const meeting = await storage.createMeeting(meetingData);
      res.json(meeting);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/meetings/:id", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) return res.status(404).json({ message: "Meeting not found" });
      if (meeting.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });
      const { status, totalMinutes, conversationContext, model, saveTranscript, saveFacts, incognito } = req.body;
      const updateData: any = {};
      if (status && ["setup", "active", "completed", "paused"].includes(status)) {
        updateData.status = status;
      }
      if (typeof totalMinutes === "number" && totalMinutes >= 0) {
        updateData.totalMinutes = totalMinutes;
      }
      if (typeof conversationContext === "string") {
        updateData.conversationContext = conversationContext;
      }
      if (typeof model === "string" && model) {
        updateData.model = model;
      }
      if (typeof saveTranscript === "boolean") {
        updateData.saveTranscript = saveTranscript;
      }
      if (typeof saveFacts === "boolean") {
        updateData.saveFacts = saveFacts;
      }
      if (typeof incognito === "boolean") {
        updateData.incognito = incognito;
        if (incognito) {
          updateData.saveTranscript = false;
          updateData.saveFacts = false;
        }
      }
      if (Object.keys(updateData).length === 0) {
        return res.json(meeting);
      }
      const updated = await storage.updateMeeting(req.params.id, updateData);
      res.json(updated);

      // Fire-and-forget: generate post-session review when session completes
      if (updateData.status === "completed" && !meeting.incognito) {
        generateSessionReview(req.params.id).catch((err) =>
          console.error("[sessionReview] background generation failed:", err.message),
        );
      }

      // Track practice minutes for free-trial window
      if (updateData.status === "completed" && meeting.isPractice) {
        const FREE_MINUTES = 6;
        const WINDOW_MS = 30 * 60 * 1000;
        const usedMinutes = typeof totalMinutes === "number" ? totalMinutes : (updated.totalMinutes || 0);
        try {
          const user = await storage.getUser(req.userId);
          if (user) {
            const now = new Date();
            const windowStart = user.practiceWindowStart ? new Date(user.practiceWindowStart) : null;
            const windowExpired = !windowStart || (now.getTime() - windowStart.getTime()) > WINDOW_MS;
            if (windowExpired) {
              // Cap at FREE_MINUTES to prevent over-recording
              await storage.updateUser(req.userId, { practiceWindowStart: now, practiceMinutesUsed: Math.min(usedMinutes, FREE_MINUTES) });
            } else {
              // Cap total so session-tick + completion don't double-count beyond limit
              const newUsed = Math.min((user.practiceMinutesUsed || 0) + usedMinutes, FREE_MINUTES);
              await storage.updateUser(req.userId, { practiceMinutesUsed: newUsed });
            }
          }
        } catch (err: any) {
          console.error("[practice] failed to update practice window:", err.message);
        }
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/practice/status", requireAuth, async (req: any, res) => {
    const FREE_MINUTES = 6;
    const WINDOW_MS = 30 * 60 * 1000;
    try {
      const user = await storage.getUser(req.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const now = new Date();
      const windowStart = user.practiceWindowStart ? new Date(user.practiceWindowStart) : null;
      const windowExpired = !windowStart || (now.getTime() - windowStart.getTime()) > WINDOW_MS;
      if (windowExpired) {
        return res.json({ minutesRemaining: FREE_MINUTES, minutesUsed: 0, nextResetAt: null });
      }
      const used = user.practiceMinutesUsed || 0;
      const remaining = Math.max(0, FREE_MINUTES - used);
      const nextResetAt = new Date(windowStart!.getTime() + WINDOW_MS);
      res.json({ minutesRemaining: remaining, minutesUsed: used, nextResetAt });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/meetings/:id", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) return res.status(404).json({ message: "Meeting not found" });
      if (meeting.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });
      await storage.deleteMeeting(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/meetings/:id/responses", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) return res.status(404).json({ message: "Meeting not found" });
      if (meeting.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });
      const meetingResponses = await storage.getResponses(req.params.id);
      res.json(meetingResponses);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Structured answer endpoint ───────────────────────────────────────────────
  // Returns a typed JSON answer instead of a stream. Used when the client wants
  // the full structured CodingAnswer/GeneralAnswer payload in one shot.
  app.post("/api/answer", requireAuth, async (req: any, res) => {
    try {
      const { question, sessionId, priorContext, languageHint, isFollowup, model } = req.body;

      if (!question || typeof question !== "string") {
        return res.status(400).json({ error: "question is required" });
      }

      // Enrich follow-up requests with live coding state if a sessionId was provided
      let priorState: { summary: string; language: string; time: string; space: string } | undefined;
      if (isFollowup && sessionId) {
        const codingState = getCodingProblemState(String(sessionId));
        if (codingState) {
          const summaryParts: string[] = [];
          if (codingState.problemType)    summaryParts.push(codingState.problemType);
          if (codingState.activeApproach) summaryParts.push(`using ${codingState.activeApproach}`);
          priorState = {
            summary:  summaryParts.join(" ") || "previous solution",
            language: codingState.chosenLanguage || "",
            time:     codingState.currentComplexity.time  || "",
            space:    codingState.currentComplexity.space || "",
          };
        }
      }

      const answer = await getStructuredInterviewAnswer({
        question,
        priorContext,
        languageHint,
        isFollowup: Boolean(isFollowup),
        priorState,
        model,
      });

      return res.json(answer);
    } catch (err: any) {
      console.error("[/api/answer] error:", err.message);
      return res.status(500).json({ error: "Failed to generate answer", details: err.message });
    }
  });

  app.get("/api/memory/slots", requireAuth, async (req: any, res) => {
    try {
      const slots = await storage.getActiveMemorySlots(req.userId);
      res.json(slots);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/meetings/:id/memory", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) return res.status(404).json({ message: "Meeting not found" });
      if (meeting.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });
      const slots = await storage.getMemorySlots(req.userId, req.params.id);
      res.json({
        slots,
        rollingSummary: meeting.rollingSummary,
        saveTranscript: meeting.saveTranscript,
        saveFacts: meeting.saveFacts,
        incognito: meeting.incognito,
        turnCount: meeting.turnCount,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/meetings/:id/session-review", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) return res.status(404).json({ message: "Meeting not found" });
      if (meeting.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });
      const allDocs = await storage.getDocuments(req.userId);
      const reviewDoc = allDocs.find((d: any) => d.name === `_session_review_${req.params.id}`);
      if (!reviewDoc) return res.json({ review: null });
      res.json({ review: (reviewDoc as any).content });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Session access: free-tier 6 min per 30 min window ──────────────────────
  app.get("/api/meetings/:id/session-access", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) return res.status(404).json({ message: "Meeting not found" });
      if (meeting.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });

      const user = await storage.getUser(req.userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      // Full access: paid plan, purchased minutes, referral credits, or admin
      const hasPaidPlan = user.plan && user.plan !== "free";
      const hasPurchasedMinutes = (user.minutesPurchased ?? 0) > (user.minutesUsed ?? 0);
      const hasReferralCredits = (user.referralCredits ?? 0) > 0;
      const isAdmin = user.role === "admin";
      const hasFullAccess = !!(hasPaidPlan || hasPurchasedMinutes || hasReferralCredits || isAdmin);

      if (hasFullAccess) {
        return res.json({ hasFullAccess: true, freeSecondsRemaining: null, windowResetAt: null });
      }

      // Free tier: 6 min (360 s) per 30-min rolling window
      const FREE_SECONDS = 360;
      const WINDOW_MS = 30 * 60 * 1000;
      const now = Date.now();
      const windowStart = user.practiceWindowStart ? new Date(user.practiceWindowStart).getTime() : null;
      const withinWindow = windowStart !== null && (now - windowStart) < WINDOW_MS;

      let usedSeconds = 0;
      let windowResetAt: string | null = null;
      if (withinWindow && windowStart) {
        usedSeconds = (user.practiceMinutesUsed ?? 0) * 60;
        windowResetAt = new Date(windowStart + WINDOW_MS).toISOString();
      }

      const freeSecondsRemaining = Math.max(0, FREE_SECONDS - usedSeconds);
      return res.json({ hasFullAccess: false, freeSecondsRemaining, windowResetAt });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Record usage tick for a session.
  // Body: { minutes?: number } — defaults to 1. Sending the full session total at once
  // avoids the read-modify-write race condition that parallel per-minute calls would cause.
  app.post("/api/meetings/:id/session-tick", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) return res.status(404).json({ message: "Meeting not found" });
      if (meeting.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });

      const user = await storage.getUser(req.userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const minutes = Math.max(1, Math.round(Number(req.body?.minutes ?? 1)));

      const hasPaidPlan = user.plan && user.plan !== "free";
      const hasPurchasedMinutes = (user.minutesPurchased ?? 0) > (user.minutesUsed ?? 0);
      const hasReferralCredits = (user.referralCredits ?? 0) > 0;
      const isAdmin = user.role === "admin";

      if (hasPaidPlan || hasReferralCredits || isAdmin || hasPurchasedMinutes) {
        // Atomic SQL increment — no read-modify-write race condition
        const updated = await storage.incrementMinutesUsed(req.userId, minutes);
        const newUsed = updated.minutesUsed ?? 0;
        const purchasedBalance = (updated.minutesPurchased ?? 0) - newUsed;
        const remaining = hasPaidPlan || isAdmin
          ? null
          : Math.max(0, purchasedBalance > 0 ? purchasedBalance : (user.referralCredits ?? 0));
        return res.json({ ok: true, minutesUsed: newUsed, minutesRemaining: remaining });
      }

      // Free tier: deduct from practice window
      const FREE_MINUTES = 6;
      const WINDOW_MS = 30 * 60 * 1000;
      const now = Date.now();
      const windowStart = user.practiceWindowStart ? new Date(user.practiceWindowStart).getTime() : null;
      const withinWindow = windowStart !== null && (now - windowStart) < WINDOW_MS;

      if (!withinWindow) {
        // New window: cap at FREE_MINUTES so over-reporting can't inflate beyond the limit
        await storage.updateUser(req.userId, {
          practiceWindowStart: new Date(),
          practiceMinutesUsed: Math.min(minutes, FREE_MINUTES),
        });
      } else {
        // Cap total within window at FREE_MINUTES — handles duplicate/late ticks safely
        const newUsed = Math.min((user.practiceMinutesUsed ?? 0) + minutes, FREE_MINUTES);
        await storage.updateUser(req.userId, { practiceMinutesUsed: newUsed });
      }

      return res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/meetings/:id/memory", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) return res.status(404).json({ message: "Meeting not found" });
      if (meeting.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });
      await storage.deleteMemorySlotsByMeeting(req.params.id);
      await storage.updateMeeting(req.params.id, { rollingSummary: "", turnCount: 0 });
      res.json({ message: "Session memory cleared" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/memory/all", requireAuth, async (req: any, res) => {
    try {
      await storage.deleteMemorySlotsByUser(req.userId);
      res.json({ message: "All memory cleared" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/export/data", requireAuth, async (req: any, res) => {
    try {
      const data = await storage.exportUserData(req.userId);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=zoom-mate-data.json");
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/meetings/:id/ask", requireAuth, async (req: any, res) => {
    try {
      const { question, format } = req.body;
      if (!question) {
        return res.status(400).json({ message: "Question is required" });
      }

      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) return res.status(404).json({ message: "Meeting not found" });
      if (meeting.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });

      let documentContext = "";
      if (meeting.documentIds && meeting.documentIds.length > 0) {
        documentContext = await retrieveDocumentContext(req.userId, question, meeting.documentIds);
      }
      if (!documentContext) {
        const allDocs = await storage.getDocuments(req.userId);
        if (allDocs.length > 0) {
          documentContext = await retrieveDocumentContext(req.userId, question, allDocs.map((d) => d.id));
        }
      }

      const validFormats = ["automatic", "concise", "detailed", "star", "bullet", "technical", "short", "custom"];
      const responseFormat = validFormats.includes(format) ? format : meeting.responseFormat;

      let effectiveModel = meeting.model || "gpt-4o-mini";
      if (effectiveModel === "automatic") {
        effectiveModel = resolveAutomaticInterviewModel(question, { sessionMode: meeting.sessionMode });
      }

      const answer = await generateResponse(
        question,
        responseFormat,
        meeting.type,
        meeting.customInstructions,
        documentContext || undefined,
        meeting.conversationContext || undefined,
        effectiveModel
      );

      const response = await storage.createResponse({
        meetingId: req.params.id,
        question,
        answer,
        responseType: responseFormat,
      });

      res.json(response);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/meetings/:id/prepare-answer", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting || meeting.userId !== req.userId) {
        return res.status(404).json({ message: "Meeting not found" });
      }

      const question = String(req.body?.question || "").trim();
      if (!question) {
        return res.status(400).json({ message: "Question is required" });
      }

      const docsMode = req.body?.docsMode === "always" || req.body?.docsMode === "off" ? req.body.docsMode : "auto";
      const questionFingerprint = normalizeForDedup(question).slice(0, 240) || "q";
      const settings = toHotPathMeetingSettings(meeting);

      await getOrLoadSettings(req.userId, req.params.id, async () => settings);
      getOrLoadConversationSummary(req.params.id, () => settings.rollingSummary || "");

      const effectiveModel = (typeof req.body?.model === "string" && req.body.model.trim())
        ? req.body.model.trim()
        : (meeting.model || "automatic");
      await getUseCaseConfigWithScope("LIVE_INTERVIEW_ANSWER", req.userId, effectiveModel === "automatic"
        ? resolveAutomaticInterviewModel(question, { sessionMode: meeting.sessionMode })
        : effectiveModel);

      if ((docsMode === "always" || docsMode === "auto") && Array.isArray(settings.documentIds) && settings.documentIds.length > 0) {
        await getOrLoadDocRetrieval(
          req.params.id,
          questionFingerprint,
          settings.documentIds.slice().sort().join(","),
          async () => retrieveDocumentContext(req.userId, question, settings.documentIds),
        );
      }

      void formatMemorySlotsForPrompt(req.userId, req.params.id).catch(() => {});

      res.json({ prepared: true });
    } catch (error: any) {
      console.error("[prepare-answer] error:", error?.message || error);
      res.status(500).json({ message: error?.message || "Failed to prepare answer" });
    }
  });

  function trimConversationContext(context: string | undefined, maxTurns = 4): string {
    if (!context) return "";
    const lines = context.split("\n").filter(l => l.trim());
    const turnLines = lines.filter(l => l.startsWith("[Speaker]:") || l.startsWith("[Zoom Mate]:"));
    if (turnLines.length <= maxTurns * 2) return context;
    return turnLines.slice(-maxTurns * 2).join("\n");
  }

  const docCache = new Map<string, { docs: any[]; ts: number }>();
  const DOC_CACHE_TTL = 60_000;
  async function docCacheGet(userId: string): Promise<any[]> {
    const cached = docCache.get(userId);
    if (cached && Date.now() - cached.ts < DOC_CACHE_TTL) return cached.docs;
    const docs = await storage.getDocuments(userId);
    docCache.set(userId, { docs, ts: Date.now() });
    return docs;
  }

  function needsDocRetrieval(question: string): boolean {
    const q = question.toLowerCase();
    const genericPatterns = [
      "tell me about yourself", "introduce yourself", "why this role", "why this company",
      "strengths", "weaknesses", "where do you see yourself", "greatest achievement",
      "why should we hire you", "what motivates you", "describe yourself",
      "walk me through your resume", "tell me about your background",
    ];
    if (genericPatterns.some(p => q.includes(p))) return true;
    const specificSignals = [
      /project/i, /experience with/i, /you (use|build|implement|design|work)/i,
      /at [\w]+/i, /your (role|team|contribution)/i, /\d+/,
      /tech(nolog|nical|stack)/i, /company/i, /resume/i, /portfolio/i,
    ];
    return specificSignals.some(p => p.test(question));
  }

  function capTokens(text: string, maxTokens: number): string {
    const words = text.split(/\s+/);
    const approxTokens = Math.ceil(words.length * 1.3);
    if (approxTokens <= maxTokens) return text;
    const keep = Math.floor(maxTokens / 1.3);
    return words.slice(0, keep).join(" ") + "...";
  }

  async function fetchDocumentContext(meeting: any, userId: string): Promise<string> {
    let documentContext = "";
    if (meeting.documentIds && meeting.documentIds.length > 0) {
      documentContext = await retrieveDocumentContext(userId, meeting.title || "interview context", meeting.documentIds);
    }
    if (!documentContext) {
      const allDocs = await storage.getDocuments(userId);
      if (allDocs.length > 0) {
        documentContext = await retrieveDocumentContext(userId, meeting.title || "interview context", allDocs.map((d) => d.id));
      }
    }
    return capTokens(documentContext, 1500);
  }

  function toHotPathMeetingSettings(meeting: any) {
    return {
      responseFormat: meeting?.responseFormat || "concise",
      customInstructions: meeting?.customInstructions || "",
      type: meeting?.type || "interview",
      conversationContext: String(meeting?.conversationContext || ""),
      documentIds: Array.isArray(meeting?.documentIds) ? meeting.documentIds as string[] : [],
      rollingSummary: meeting?.rollingSummary || "",
      interviewStyle: meeting?.interviewStyle,
    };
  }

  app.post("/api/meetings/:id/ask-stream", requireAuth, async (req: any, res) => {
    try {
      const { question, format, customFormatPrompt, quickMode, docsMode, model, systemPrompt } = req.body || {};
      if (!question || typeof question !== "string" || !question.trim()) {
        return res.status(400).json({ message: "Question is required" });
      }
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) {
        return res.status(404).json({ message: "Meeting not found" });
      }
      if (meeting.userId !== req.userId) {
        return res.status(403).json({ message: "Not authorized" });
      }
      await streamAssistantAnswer(req, res, {
        meetingId: req.params.id,
        userId: req.userId,
        question: question.trim(),
        format,
        customFormatPrompt,
        sessionSystemPrompt: typeof systemPrompt === "string" ? systemPrompt.trim() || undefined : undefined,
        quickMode,
        docsMode: docsMode === "always" || docsMode === "off" ? docsMode : "auto",
        meeting,
        model: typeof model === "string" ? model : undefined,
      });
    } catch (error: any) {
      console.error("[ask-stream] Error:", error.message, error.stack?.slice(0, 300));
      if (!res.headersSent) {
        res.status(500).json({ message: error.message });
      }
    }
  });

  app.post("/api/meetings/:id/assistant/stream", requireAuth, async (req: any, res) => {
    try {
      const { question, format, customFormatPrompt, quickMode, docsMode, model, systemPrompt } = req.body || {};
      if (!question || typeof question !== "string" || !question.trim()) {
        return res.status(400).json({ message: "Question is required" });
      }
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) {
        return res.status(404).json({ message: "Meeting not found" });
      }
      if (meeting.userId !== req.userId) {
        return res.status(403).json({ message: "Not authorized" });
      }
      await streamAssistantAnswer(req, res, {
        meetingId: req.params.id,
        userId: req.userId,
        question: question.trim(),
        format,
        customFormatPrompt,
        sessionSystemPrompt: typeof systemPrompt === "string" ? systemPrompt.trim() || undefined : undefined,
        quickMode,
        docsMode: docsMode === "always" || docsMode === "off" ? docsMode : "auto",
        meeting,
        model: typeof model === "string" ? model : undefined,
      });
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ message: error.message || "Failed to stream assistant answer" });
      }
    }
  });

  // ── Screen context for typing injection (desktop app) ──────────────────────
  // Returns: { platform, language, already_typed, is_coding }
  // Used by the Typing Playback feature to read what's on screen before injecting.
  app.post("/api/screen-context", requireAuth, async (req: any, res) => {
    try {
      const { image } = req.body;
      if (!image) return res.status(400).json({ message: "image required" });
      const { getOpenAIKey } = await import("./llmRouter");
      const apiKey = await getOpenAIKey();
      if (!apiKey) return res.status(500).json({ message: "No OpenAI key configured" });

      const imageMatch = String(image).match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
      const imageDataUrl = imageMatch?.[0] || `data:image/png;base64,${image}`;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: `Analyze this screenshot and return ONLY a JSON object with these exact fields:
- platform: the coding platform or editor visible (e.g. "LeetCode", "HackerRank", "VSCode", "Replit", "unknown")
- language: programming language selected or visible in editor (e.g. "python", "javascript", "java", "cpp", "unknown")
- already_typed: the exact code currently in the main editor/code area as a string (empty string "" if nothing typed yet)
- is_coding: true if this is a coding environment, false otherwise
- has_error: true if there is a visible error, exception, test failure, or wrong answer result on screen, false otherwise
- error_message: the exact error text or "Wrong Answer" / "Runtime Error" / "TLE" shown on screen (empty string "" if no error)
- problem_text: the full problem/question statement visible on screen — include the title, description, constraints, and examples exactly as shown (empty string "" if no problem visible)
- question_type: one of "coding" | "behavioral" | "system_design" | "conceptual" | "unknown"

Return ONLY valid JSON. No explanation, no markdown, no code fences. Just the JSON object.` },
              { type: "image_url", image_url: { url: imageDataUrl, detail: "low" } },
            ],
          }],
          max_tokens: 600,
          temperature: 0,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(500).json({ message: `OpenAI error: ${err}` });
      }

      const result = await response.json() as any;
      const text = (result.choices?.[0]?.message?.content || "{}").replace(/^```json\n?|\n?```$/g, "").trim();
      try {
        res.json(JSON.parse(text));
      } catch {
        res.json({ platform: "unknown", language: "unknown", already_typed: "", is_coding: false, has_error: false, error_message: "", problem_text: "", question_type: "unknown" });
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/meetings/:id/analyze-screen", requireAuth, async (req: any, res) => {
    try {
      const { image, question, displayQuestion } = req.body;
      if (!image) {
        return res.status(400).json({ message: "Screen capture is required" });
      }

      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) return res.status(404).json({ message: "Meeting not found" });
      if (meeting.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });

      const isCodingScreen = meeting.sessionMode === "coding";
      const effectiveDisplayQuestion = isCodingScreen
        ? "Screen Capture Analysis"
        : (displayQuestion || question || "[Screen Analysis]");
      const effectiveQuestion = (isCodingScreen || question)
        ? [
            question || "This is a live coding interview screen.",
            "Ignore live transcript for capture analysis.",
            "Infer the required answer from the visible coding problem statement, code, editor, examples, constraints, and edits on screen.",
            "Trust the visible screen as the source of truth.",
            "If the visible screen shows updated requirements or modified code, answer the updated version shown on screen.",
            "OUTPUT FORMAT (strictly follow this order):",
            "1. Explanation first (2-3 sentences): plain-text explanation of the approach or what changed — in first person. NEVER start with a code block.",
            "2. Code block: complete solution in a fenced code block (e.g. ```python).",
            "3. What changed: list each modified line/block and why (for follow-ups/modifications only).",
            "4. Complexity: one short line on time/space complexity when relevant.",
          ].join("\n")
        : "Analyze this screen and help me respond appropriately.";

      let documentContext = "";
      if (meeting.documentIds && meeting.documentIds.length > 0) {
        documentContext = await retrieveDocumentContext(req.userId, effectiveDisplayQuestion, meeting.documentIds);
      }
      if (!documentContext) {
        const allDocs = await storage.getDocuments(req.userId);
        if (allDocs.length > 0) {
          documentContext = await retrieveDocumentContext(req.userId, effectiveDisplayQuestion, allDocs.map((d) => d.id));
        }
      }

      const answer = await analyzeScreen(
        image,
        effectiveQuestion,
        meeting.type,
        documentContext || undefined,
        meeting.model || undefined,
        meeting.sessionMode || undefined
      );

      const response = await storage.createResponse({
        meetingId: req.params.id,
        question: effectiveDisplayQuestion,
        answer,
        responseType: "screen-analysis",
      });

      setCodeContext(req.params.id, {
        question: effectiveDisplayQuestion,
        answer,
        capturedAt: response.createdAt ? new Date(response.createdAt).getTime() : Date.now(),
      });

      res.json(response);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Capture & Solve (desktop app — no meeting required) ────────────────────
  // Screenshots the screen, reads the problem, streams back the full solution.
  app.post("/api/screen-solve", requireAuth, async (req: any, res) => {
    try {
      const { image } = req.body;
      if (!image) return res.status(400).json({ message: "image required" });

      const allDocs = await storage.getDocuments(req.userId);
      let documentContext = "";
      if (allDocs.length > 0) {
        documentContext = await retrieveDocumentContext(req.userId, "coding problem on screen", allDocs.map((d) => d.id));
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Content-Encoding": "none",
      });
      res.flushHeaders();
      res.write(":ok\n\n");

      const question = [
        "This is a live coding interview screen.",
        "Read the visible problem statement, examples, constraints, and any code already written.",
        "Solve or fix the problem shown. Treat the visible screen as the source of truth.",
        "OUTPUT FORMAT (strictly follow this order):",
        "1. Explanation first (2-3 sentences): approach in first person. NEVER start with a code block.",
        "2. Code block: complete solution in a fenced code block (e.g. ```python).",
        "3. Complexity: one short line on time/space complexity.",
      ].join("\n");

      const generator = analyzeScreenStream(
        image,
        question,
        "technical",
        documentContext || undefined,
        undefined,
        "coding",
      );

      for await (const chunk of generator) {
        res.write("event: chunk\n");
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }

      res.write("event: done\n");
      res.write(`data: ${JSON.stringify({})}\n\n`);
      res.end();
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ message: error.message });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/meetings/:id/analyze-screen-stream", requireAuth, async (req: any, res) => {
    try {
      const { image, question, displayQuestion, liveTranscript } = req.body;
      if (!image) return res.status(400).json({ message: "Screen capture is required" });

      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) return res.status(404).json({ message: "Meeting not found" });
      if (meeting.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });

      const isCodingScreen = meeting.sessionMode === "coding";
      const effectiveDisplayQuestion = isCodingScreen
        ? "Screen Capture Analysis"
        : (displayQuestion || question || "[Screen Analysis]");
      const effectiveQuestion = (isCodingScreen || question)
        ? [
            question || "This is a live coding interview screen.",
            "Ignore live transcript for capture analysis.",
            "Infer the required answer from the visible coding problem statement, code, editor, examples, constraints, and edits on screen.",
            "Trust the visible screen as the source of truth.",
            "If the visible screen shows updated requirements or modified code, answer the updated version shown on screen.",
            "OUTPUT FORMAT (strictly follow this order):",
            "1. Explanation first (2-3 sentences): plain-text explanation of the approach or what changed — in first person. NEVER start with a code block.",
            "2. Code block: complete solution in a fenced code block (e.g. ```python).",
            "3. What changed: list each modified line/block and why (for follow-ups/modifications only).",
            "4. Complexity: one short line on time/space complexity when relevant.",
          ].join("\n")
        : "Analyze this screen and help me respond appropriately.";

      let documentContext = "";
      if (meeting.documentIds && meeting.documentIds.length > 0) {
        documentContext = await retrieveDocumentContext(req.userId, effectiveDisplayQuestion, meeting.documentIds);
      }
      if (!documentContext) {
        const allDocs = await storage.getDocuments(req.userId);
        if (allDocs.length > 0) {
          documentContext = await retrieveDocumentContext(req.userId, effectiveDisplayQuestion, allDocs.map((d) => d.id));
        }
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Content-Encoding": "none",
      });
      res.flushHeaders();
      res.write(":ok\n\n");

      let fullAnswer = "";
      const generator = analyzeScreenStream(
        image,
        effectiveQuestion,
        meeting.type,
        documentContext || undefined,
        meeting.model || undefined,
        meeting.sessionMode || undefined,
        liveTranscript || undefined,
      );

      for await (const chunk of generator) {
        fullAnswer += chunk;
        res.write("event: chunk\n");
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }

      const response = await storage.createResponse({
        meetingId: req.params.id,
        question: effectiveDisplayQuestion,
        answer: fullAnswer,
        responseType: "screen-analysis",
      });

      setCodeContext(req.params.id, {
        question: effectiveDisplayQuestion,
        answer: fullAnswer,
        capturedAt: response.createdAt ? new Date(response.createdAt).getTime() : Date.now(),
      });

      res.write("event: done\n");
      res.write(`data: ${JSON.stringify({ response })}\n\n`);
      res.end();
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ message: error.message });
      } else {
        res.write("event: error\n");
        res.write(`data: ${JSON.stringify({ message: error.message || "stream failed" })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/meetings/:id/analyze-multi-screen", requireAuth, async (req: any, res) => {
    try {
      const { images, question, displayQuestion, liveTranscript } = req.body;
      if (!Array.isArray(images) || images.length === 0) {
        return res.status(400).json({ message: "At least one image is required" });
      }
      if (images.length > 6) {
        return res.status(400).json({ message: "Maximum 6 captures allowed at once" });
      }

      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) return res.status(404).json({ message: "Meeting not found" });
      if (meeting.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });

      const effectiveDisplayQuestion = displayQuestion || question || `Multi-Screen Analysis (${images.length} captures)`;
      const effectiveQuestion = question || `Analyze these ${images.length} screen captures together. Look at all of them as a combined view of the code or content. Provide a complete answer based on everything visible across all captures.`;

      let documentContext = "";
      if (meeting.documentIds && meeting.documentIds.length > 0) {
        documentContext = await retrieveDocumentContext(req.userId, effectiveDisplayQuestion, meeting.documentIds);
      }
      if (!documentContext) {
        const allDocs = await storage.getDocuments(req.userId);
        if (allDocs.length > 0) {
          documentContext = await retrieveDocumentContext(req.userId, effectiveDisplayQuestion, allDocs.map((d) => d.id));
        }
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Content-Encoding": "none",
      });
      res.flushHeaders();
      res.write(":ok\n\n");

      let fullAnswer = "";
      const generator = analyzeMultiScreenStream(
        images,
        effectiveQuestion,
        meeting.type,
        documentContext || undefined,
        meeting.model || undefined,
        meeting.sessionMode || undefined,
        liveTranscript || undefined,
      );

      for await (const chunk of generator) {
        fullAnswer += chunk;
        res.write("event: chunk\n");
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }

      const response = await storage.createResponse({
        meetingId: req.params.id,
        question: effectiveDisplayQuestion,
        answer: fullAnswer,
        responseType: "screen-analysis",
      });

      setCodeContext(req.params.id, {
        question: effectiveDisplayQuestion,
        answer: fullAnswer,
        capturedAt: response.createdAt ? new Date(response.createdAt).getTime() : Date.now(),
      });

      res.write("event: done\n");
      res.write(`data: ${JSON.stringify({ response })}\n\n`);
      res.end();
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ message: error.message });
      } else {
        res.write("event: error\n");
        res.write(`data: ${JSON.stringify({ message: error.message || "multi-screen analysis failed" })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/meetings/:id/prepare-screen-analysis", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting) return res.status(404).json({ message: "Meeting not found" });
      if (meeting.userId !== req.userId) return res.status(403).json({ message: "Not authorized" });

      const defaultModel = await storage.getSetting("default_model");
      const selectedModel = meeting.sessionMode === "coding"
        ? "gpt-4o-mini"
        : (meeting.model || defaultModel || "gpt-4o-mini");

      await resolveLLMConfig(selectedModel);

      if (meeting.documentIds && meeting.documentIds.length > 0) {
        await retrieveDocumentContext(req.userId, "screen capture analysis", meeting.documentIds).catch(() => "");
      }

      res.json({ prepared: true, model: selectedModel });
    } catch (error: any) {
      console.error("[prepare-screen-analysis] error:", error?.message || error);
      res.status(500).json({ message: error?.message || "Failed to prepare screen analysis" });
    }
  });

  app.post("/api/transcribe", requireAuth, upload.single("audio"), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Audio file is required" });
      }

      const provider = req.body?.provider || "whisper";
      const language = req.body?.language || "en-US";
      const langCode = language.split("-")[0];

      if (provider === "google") {
        try {
          const { transcribeWithGoogle } = await import("./transcription/googleStt");
          const audioBuffer = fs.readFileSync(req.file.path);
          const text = await transcribeWithGoogle(audioBuffer, req.file.mimetype || "audio/webm", language);
          try { fs.unlinkSync(req.file.path); } catch {}
          return res.json({ text });
        } catch (error: any) {
          try { fs.unlinkSync(req.file.path); } catch {}
          console.error("Google STT error:", error.message);
          if (error.message?.includes("not configured") || error.message?.includes("Invalid")) {
            return res.status(400).json({ message: error.message });
          }
          return res.status(500).json({ message: error.message || "Google STT transcription failed. Check credentials in Admin > Settings." });
        }
      }

      const customKey = await storage.getSetting("openai_api_key");
      const apiKey = customKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(500).json({ message: "OpenAI API key is not configured" });
      }

      const client = new OpenAI({ apiKey });

      const filePath = req.file.path;
      const ext = req.file.originalname?.split(".").pop() || "webm";
      const newPath = filePath + "." + ext;
      fs.renameSync(filePath, newPath);

      try {
        const transcription = await client.audio.transcriptions.create({
          file: fs.createReadStream(newPath),
          model: "whisper-1",
          language: langCode,
          response_format: "text",
        });

        res.json({ text: transcription });
      } finally {
        try { fs.unlinkSync(newPath); } catch (e) {}
      }
    } catch (error: any) {
      console.error("Transcription error:", error);
      res.status(500).json({ message: error.message || "Transcription failed" });
    }
  });

  app.get("/api/admin/stats", requireAdmin, async (req: any, res) => {
    try {
      const stats = await storage.getAdvancedStats();
      const maintenanceMode = await storage.getSetting("maintenance_mode");
      res.json({ ...stats, maintenanceMode: maintenanceMode === "true" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/users", requireAdmin, async (req: any, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      res.json(allUsers.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        role: u.role,
        minutesUsed: u.minutesUsed,
        minutesPurchased: u.minutesPurchased,
        referralCredits: u.referralCredits,
        plan: u.plan,
        status: u.status,
        lastLoginAt: u.lastLoginAt,
        stripeCustomerId: u.stripeCustomerId,
        stripeSubscriptionId: u.stripeSubscriptionId,
        createdAt: u.createdAt,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req: any, res) => {
    try {
      const { role, minutesPurchased, plan, status } = req.body;
      const updateData: any = {};
      if (role && ["user", "admin"].includes(role)) {
        updateData.role = role;
      }
      if (typeof minutesPurchased === "number" && minutesPurchased >= 0) {
        updateData.minutesPurchased = minutesPurchased;
      }
      if (plan && ["free", "standard", "enterprise"].includes(plan)) {
        updateData.plan = plan;
      }
      if (status && ["active", "suspended", "banned"].includes(status)) {
        updateData.status = status;
      }
      if (Object.keys(updateData).length === 0) {
        const user = await storage.getUser(req.params.id);
        return res.json(user);
      }
      const updated = await storage.updateUser(req.params.id, updateData);
      res.json({
        id: updated.id,
        username: updated.username,
        email: updated.email,
        role: updated.role,
        minutesUsed: updated.minutesUsed,
        minutesPurchased: updated.minutesPurchased,
        referralCredits: updated.referralCredits,
        plan: updated.plan,
        status: updated.status,
        stripeCustomerId: updated.stripeCustomerId,
        stripeSubscriptionId: updated.stripeSubscriptionId,
        createdAt: updated.createdAt,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (user.role === "admin") return res.status(400).json({ message: "Cannot delete admin users" });
      await storage.deleteUser(req.params.id);
      res.json({ message: `User ${user.username} deleted successfully` });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/users/bulk-status", requireAdmin, async (req: any, res) => {
    try {
      const { userIds, status } = req.body;
      if (!Array.isArray(userIds) || !userIds.length) {
        return res.status(400).json({ message: "User IDs are required" });
      }
      if (!["active", "suspended", "banned"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      await storage.bulkUpdateUserStatus(userIds, status);
      res.json({ message: `Updated ${userIds.length} users to ${status}` });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/users/:id/grant-credits", requireAdmin, async (req: any, res) => {
    try {
      const { amount, reason } = req.body;
      if (!amount || typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const updated = await storage.updateUser(req.params.id, {
        minutesPurchased: (user.minutesPurchased || 0) + amount,
      });

      await storage.createCreditLog({
        userId: req.params.id,
        adminId: req.userId,
        type: "grant",
        amount,
        reason: reason || "Admin granted credits",
      });

      res.json({
        id: updated.id,
        username: updated.username,
        minutesPurchased: updated.minutesPurchased,
        message: `Granted ${amount} credits to ${updated.username}`,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/users/:id/grant-referral-credits", requireAdmin, async (req: any, res) => {
    try {
      const { amount, reason } = req.body;
      if (!amount || typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const updated = await storage.updateUser(req.params.id, {
        referralCredits: (user.referralCredits || 0) + amount,
      });

      await storage.createCreditLog({
        userId: req.params.id,
        adminId: req.userId,
        type: "referral",
        amount,
        reason: reason || "Admin granted referral credits",
      });

      res.json({
        id: updated.id,
        username: updated.username,
        referralCredits: updated.referralCredits,
        message: `Granted ${amount} referral credits to ${updated.username}`,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/users/:id/cancel-subscription", requireAdmin, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      if (user.stripeSubscriptionId) {
        try {
          const stripe = await getUncachableStripeClient();
          await stripe.subscriptions.cancel(user.stripeSubscriptionId);
        } catch (stripeError: any) {
          console.error("Stripe cancellation error:", stripeError.message);
        }
      }

      const updated = await storage.updateUser(req.params.id, {
        plan: "free",
        stripeSubscriptionId: null,
      });

      await storage.createCreditLog({
        userId: req.params.id,
        adminId: req.userId,
        type: "subscription_cancelled",
        amount: 0,
        reason: req.body.reason || "Admin cancelled subscription",
      });

      res.json({
        id: updated.id,
        username: updated.username,
        plan: updated.plan,
        message: `Subscription cancelled for ${updated.username}`,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/users/:id/credit-logs", requireAdmin, async (req: any, res) => {
    try {
      const logs = await storage.getCreditLogs(req.params.id);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/credit-logs", requireAdmin, async (req: any, res) => {
    try {
      const logs = await storage.getAllCreditLogs();
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/meetings", requireAdmin, async (req: any, res) => {
    try {
      const allMeetings = await storage.getAllMeetings();
      res.json(allMeetings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/models", async (req, res) => {
    res.json(getAvailableModels());
  });

  const azureTokenHandler = async (req: any, res: any) => {
    try {
      const canUseSpeech = await hasSpeechCredits(req.userId);
      if (!canUseSpeech) {
        return res.status(402).json({ message: "No credits remaining for speech transcription." });
      }
      const countryCode =
        String(
          req.headers["cf-ipcountry"]
          || req.headers["x-vercel-ip-country"]
          || req.headers["x-azure-clientip-country"]
          || req.headers["x-country-code"]
          || "",
        ).trim() || null;
      const result = await mintAzureToken(req.session.userId, { countryCode });
      if (!result) {
        return res.status(404).json({ message: "Azure Speech not configured. Ask admin to set Azure Speech key and region." });
      }
      res.json({
        token: result.token,
        region: result.region,
        expires_in_seconds: result.expiresInSeconds,
      });
    } catch (error: any) {
      if (error.message.includes("Rate limit")) {
        return res.status(429).json({ message: error.message });
      }
      console.error("[azure-token] Error:", error.message);
      res.status(500).json({ message: "Failed to get Azure Speech token" });
    }
  };

  app.get("/api/speech/azure/token", requireAuth, azureTokenHandler);
  app.get("/api/stt/azure-token", requireAuth, azureTokenHandler);

  const azureStatusHandler = async (_req: any, res: any) => {
    try {
      const status = await getAzureStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  };

  app.get("/api/speech/azure/status", requireAuth, azureStatusHandler);
  app.get("/api/stt/azure-status", requireAuth, azureStatusHandler);

  app.get("/api/admin/settings", requireAdmin, async (req: any, res) => {
    try {
      const settings = await storage.getAllSettings();
      const safeSettings: Record<string, any> = {};
      for (const [key, value] of Object.entries(settings)) {
        if (key === "google_stt_credentials") {
          safeSettings[`${key}_set`] = !!value;
          if (value) {
            try {
              const parsed = JSON.parse(value);
              safeSettings[key] = parsed.project_id || "configured";
            } catch {
              safeSettings[key] = "configured";
            }
          } else {
            safeSettings[key] = "";
          }
        } else if (key === "azure_speech_key") {
          const decrypted = decryptSettingValue(value);
          safeSettings[`${key}_set`] = !!decrypted;
          safeSettings[`${key}_last4`] = decrypted ? decrypted.slice(-4) : "";
        } else if (key === "azure_speech_region") {
          safeSettings[key] = value || "eastus";
        } else if (key.includes("api_key")) {
          safeSettings[key] = value ? `${value.slice(0, 8)}...${value.slice(-4)}` : "";
          safeSettings[`${key}_set`] = !!value;
        } else {
          safeSettings[key] = value;
        }
      }
      safeSettings.openai_env_set = !!process.env.OPENAI_API_KEY;
      safeSettings.default_model = settings.default_model || "gpt-4o";
      res.json(safeSettings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/settings", requireAdmin, async (req: any, res) => {
    try {
      const { openai_api_key, gemini_api_key, default_model } = req.body;

      if (typeof openai_api_key === "string") {
        await storage.setSetting("openai_api_key", openai_api_key);
      }

      if (typeof gemini_api_key === "string") {
        if (gemini_api_key.trim()) {
          try {
            const { GoogleGenerativeAI } = await import("@google/generative-ai");
            const testClient = new GoogleGenerativeAI(gemini_api_key.trim());
            const testModel = testClient.getGenerativeModel({ model: "gemini-2.0-flash" });
            await testModel.generateContent("test");
          } catch (validationErr: any) {
            const errMsg = validationErr?.message || "";
            if (errMsg.includes("API_KEY_INVALID") || errMsg.includes("API key not valid") || errMsg.includes("PERMISSION_DENIED")) {
              return res.status(400).json({ message: "Invalid Gemini API key. Please check and try again." });
            }
          }
        }
        await storage.setSetting("gemini_api_key", gemini_api_key.trim());
      }

      if (typeof req.body.google_stt_credentials === "string") {
        await storage.setSetting("google_stt_credentials", req.body.google_stt_credentials);
      }

      if (typeof req.body.azure_speech_key === "string") {
        const key = req.body.azure_speech_key.trim();
        await storage.setSetting("azure_speech_key", key ? encryptSettingValue(key) : "");
      }
      if (typeof req.body.azure_speech_region === "string") {
        await storage.setSetting("azure_speech_region", req.body.azure_speech_region.trim() || "eastus");
      }

      if (typeof default_model === "string" && default_model) {
        await storage.setSetting("default_model", default_model);
      }

      if (typeof req.body.memory_retention_days === "string") {
        await storage.setSetting("memory_retention_days", req.body.memory_retention_days);
      }
      if (typeof req.body.transcript_retention_days === "string") {
        await storage.setSetting("transcript_retention_days", req.body.transcript_retention_days);
      }

      invalidateSettingsCache();
      res.json({ message: "Settings updated successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/memory/cleanup", requireAdmin, async (req: any, res) => {
    try {
      const memRetention = parseInt(await storage.getSetting("memory_retention_days") || "90");
      const txRetention = parseInt(await storage.getSetting("transcript_retention_days") || "30");
      const slotsDeleted = await storage.cleanupOldMemorySlots(memRetention);
      const responsesDeleted = await storage.cleanupOldResponses(txRetention);
      res.json({ message: `Cleanup complete. Deleted ${slotsDeleted} memory slots, ${responsesDeleted} responses.` });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/stripe/products", requireAdmin, async (req: any, res) => {
    try {
      const result = await db.execute(sql`
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.metadata as product_metadata,
          p.active as product_active,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring,
          pr.active as price_active
        FROM stripe.products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id
        ORDER BY p.name ASC, pr.unit_amount ASC
      `);

      const productsMap = new Map();
      for (const row of result.rows as any[]) {
        if (!productsMap.has(row.product_id)) {
          productsMap.set(row.product_id, {
            id: row.product_id,
            name: row.product_name,
            description: row.product_description,
            metadata: row.product_metadata,
            active: row.product_active,
            prices: [],
          });
        }
        if (row.price_id) {
          productsMap.get(row.product_id).prices.push({
            id: row.price_id,
            unit_amount: row.unit_amount,
            currency: row.currency,
            recurring: row.recurring,
            active: row.price_active,
          });
        }
      }

      res.json(Array.from(productsMap.values()));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/stripe/products", requireAdmin, async (req: any, res) => {
    try {
      const { name, description, price, interval } = req.body;
      if (!name || !price) {
        return res.status(400).json({ message: "Name and price are required" });
      }

      const stripe = await getUncachableStripeClient();
      const product = await stripe.products.create({
        name,
        description: description || undefined,
      });

      const priceObj = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(price * 100),
        currency: "usd",
        recurring: { interval: interval || "month" },
      });

      res.json({ product, price: priceObj });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/stripe/products/:id", requireAdmin, async (req: any, res) => {
    try {
      const { name, description, active } = req.body;
      const stripe = await getUncachableStripeClient();
      const updateData: any = {};
      if (typeof name === "string") updateData.name = name;
      if (typeof description === "string") updateData.description = description;
      if (typeof active === "boolean") updateData.active = active;
      const product = await stripe.products.update(req.params.id, updateData);
      res.json(product);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/stripe/prices", requireAdmin, async (req: any, res) => {
    try {
      const { productId, price, interval } = req.body;
      if (!productId || !price) {
        return res.status(400).json({ message: "Product ID and price are required" });
      }

      const stripe = await getUncachableStripeClient();
      const priceObj = await stripe.prices.create({
        product: productId,
        unit_amount: Math.round(price * 100),
        currency: "usd",
        recurring: { interval: interval || "month" },
      });

      res.json(priceObj);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/stripe/prices/:id", requireAdmin, async (req: any, res) => {
    try {
      const { active } = req.body;
      const stripe = await getUncachableStripeClient();
      const price = await stripe.prices.update(req.params.id, { active });
      res.json(price);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/stripe/subscriptions", requireAdmin, async (req: any, res) => {
    try {
      const result = await db.execute(sql`
        SELECT s.*, u.username, u.email 
        FROM stripe.subscriptions s
        LEFT JOIN users u ON u.stripe_customer_id = s.customer
        ORDER BY s.created DESC
        LIMIT 100
      `);
      res.json(result.rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/stripe/publishable-key", async (req, res) => {
    try {
      const key = await getStripePublishableKey();
      res.json({ publishableKey: key });
    } catch (error: any) {
      res.status(500).json({ message: "Stripe not configured" });
    }
  });

  app.get("/api/stripe/products", async (req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.metadata as product_metadata,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring,
          pr.active as price_active
        FROM stripe.products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        WHERE p.active = true
        ORDER BY pr.unit_amount ASC
      `);

      const productsMap = new Map();
      for (const row of result.rows as any[]) {
        if (!productsMap.has(row.product_id)) {
          productsMap.set(row.product_id, {
            id: row.product_id,
            name: row.product_name,
            description: row.product_description,
            metadata: row.product_metadata,
            prices: [],
          });
        }
        if (row.price_id) {
          productsMap.get(row.product_id).prices.push({
            id: row.price_id,
            unit_amount: row.unit_amount,
            currency: row.currency,
            recurring: row.recurring,
          });
        }
      }

      res.json(Array.from(productsMap.values()));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stripe/checkout", requireAuth, async (req: any, res) => {
    try {
      const { priceId } = req.body;
      if (!priceId) {
        return res.status(400).json({ message: "Price ID is required" });
      }

      const user = await storage.getUser(req.userId);
      if (!user) return res.status(401).json({ message: "User not found" });

      const stripe = await getUncachableStripeClient();

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          metadata: { userId: user.id, username: user.username },
        });
        customerId = customer.id;
        await storage.updateUser(user.id, { stripeCustomerId: customerId });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "subscription",
        success_url: `${baseUrl}/dashboard?payment=success`,
        cancel_url: `${baseUrl}/dashboard?payment=cancelled`,
        metadata: { userId: user.id },
      });

      res.json({ url: session.url });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stripe/minutes-checkout", requireAuth, async (req: any, res) => {
    try {
      const minutesRequested = Number(req.body?.minutes || 0);
      const purchase = resolveMinutePurchase(minutesRequested);
      if (!purchase) {
        return res.status(400).json({ message: "Minutes must be a positive multiple of 10" });
      }

      const user = await storage.getUser(req.userId);
      if (!user) return res.status(401).json({ message: "User not found" });

      const stripe = await getUncachableStripeClient();

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          metadata: { userId: user.id, username: user.username },
        });
        customerId = customer.id;
        await storage.updateUser(user.id, { stripeCustomerId: customerId });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: purchase.label,
                  description: `${purchase.minutes} meeting minutes for Zoom Mate`,
                },
                unit_amount: purchase.amountCents,
              },
              quantity: 1,
            },
          ],
          mode: "payment",
        success_url: `${baseUrl}/dashboard?tab=minutes&minutes_purchase=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/dashboard?tab=minutes&minutes_purchase=cancelled`,
          metadata: {
            userId: user.id,
            minutes: String(purchase.minutes),
            pricingPlan: JSON.stringify(purchase.packCounts),
            kind: "minutes_purchase",
          },
        });

      res.json({ url: session.url });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stripe/minutes-confirm", requireAuth, async (req: any, res) => {
    try {
      const sessionId = String(req.body?.sessionId || "").trim();
      if (!sessionId) {
        return res.status(400).json({ message: "sessionId is required" });
      }

      const user = await storage.getUser(req.userId);
      if (!user) return res.status(401).json({ message: "User not found" });

      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (!session || session.payment_status !== "paid") {
        return res.status(400).json({ message: "Payment has not completed yet" });
      }

      const metadataUserId = String(session.metadata?.userId || "");
      const minutes = Number(session.metadata?.minutes || 0);
      if (metadataUserId !== user.id || !Number.isFinite(minutes) || minutes <= 0) {
        return res.status(400).json({ message: "Invalid purchase metadata" });
      }

      const reason = `stripe_session:${sessionId}`;
      const existing = await db.execute(
        sql`SELECT id FROM credit_logs WHERE user_id = ${user.id} AND type = 'purchase' AND reason = ${reason} LIMIT 1`
      );

      if ((existing.rows as any[]).length === 0) {
        await storage.updateUser(user.id, {
          minutesPurchased: (user.minutesPurchased || 0) + minutes,
        });

        await storage.createCreditLog({
          userId: user.id,
          adminId: user.id,
          type: "purchase",
          amount: minutes,
          reason,
        });
      }

      const refreshedUser = await storage.getUser(user.id);
      res.json({
        ok: true,
        minutesAdded: minutes,
        minutesPurchased: refreshedUser?.minutesPurchased || 0,
        minutesUsed: refreshedUser?.minutesUsed || 0,
        referralCredits: refreshedUser?.referralCredits || 0,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/stripe/subscription", requireAuth, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.userId);
      if (!user) return res.status(401).json({ message: "User not found" });

      if (!user.stripeSubscriptionId) {
        return res.json({ subscription: null, plan: user.plan });
      }

      const result = await db.execute(
        sql`SELECT * FROM stripe.subscriptions WHERE id = ${user.stripeSubscriptionId}`
      );
      const subscription = (result.rows as any[])[0] || null;
      res.json({ subscription, plan: user.plan });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stripe/portal", requireAuth, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.userId);
      if (!user) return res.status(401).json({ message: "User not found" });

      if (!user.stripeCustomerId) {
        return res.status(400).json({ message: "No billing account found" });
      }

      const stripe = await getUncachableStripeClient();
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${baseUrl}/dashboard`,
      });

      res.json({ url: portalSession.url });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/announcements", requireAdmin, async (req: any, res) => {
    try {
      const items = await storage.getAnnouncements();
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/announcements", requireAdmin, async (req: any, res) => {
    try {
      const { title, message, type } = req.body;
      if (!title || !message) {
        return res.status(400).json({ message: "Title and message are required" });
      }
      const announcement = await storage.createAnnouncement({
        title,
        message,
        type: type || "info",
      });
      res.json(announcement);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/announcements/:id", requireAdmin, async (req: any, res) => {
    try {
      const { isActive } = req.body;
      const updated = await storage.updateAnnouncement(req.params.id, { isActive });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/announcements/:id", requireAdmin, async (req: any, res) => {
    try {
      await storage.deleteAnnouncement(req.params.id);
      res.json({ message: "Announcement deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/announcements", requireAuth, async (req: any, res) => {
    try {
      const items = await storage.getActiveAnnouncements();
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/maintenance", requireAdmin, async (req: any, res) => {
    try {
      const { enabled } = req.body;
      await storage.setSetting("maintenance_mode", enabled ? "true" : "false");
      res.json({ maintenanceMode: enabled });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/export/users", requireAdmin, async (req: any, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const csvHeader = "ID,Username,Email,Role,Plan,Status,Minutes Used,Credits,Referral Credits,Created At\n";
      const csvRows = allUsers.map((u) =>
        `"${u.id}","${u.username}","${u.email || ""}","${u.role}","${u.plan}","${u.status}",${u.minutesUsed},${u.minutesPurchased},${u.referralCredits},"${u.createdAt}"`
      ).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=users-export.csv");
      res.send(csvHeader + csvRows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/export/sessions", requireAdmin, async (req: any, res) => {
    try {
      const allMeetings = await storage.getAllMeetings();
      const csvHeader = "ID,User ID,Title,Type,Model,Status,Minutes,Format,Created At\n";
      const csvRows = allMeetings.map((m) =>
        `"${m.id}","${m.userId}","${m.title}","${m.type}","${m.model}","${m.status}",${m.totalMinutes},"${m.responseFormat}","${m.createdAt}"`
      ).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=sessions-export.csv");
      res.send(csvHeader + csvRows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/router-config", requireAdmin, async (req: any, res) => {
    try {
      const configs = await storage.getAllRouterConfigs();
      res.json(configs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/admin/router-config/:useCase", requireAdmin, async (req: any, res) => {
    try {
      const { useCase } = req.params;
      const { primaryProvider, primaryModel, fallbackProvider, fallbackModel, timeoutMs, temperature, maxTokens, streamingEnabled } = req.body;
      const validProviders = ["openai", "gemini"];
      const provider = validProviders.includes(primaryProvider) ? primaryProvider : "openai";
      const model = (typeof primaryModel === "string" && primaryModel.length > 0 && primaryModel.length < 100) ? primaryModel : "gpt-4o-mini";
      const clampedTimeout = Math.max(1000, Math.min(typeof timeoutMs === "number" ? timeoutMs : 30000, 120000));
      const clampedTemp = Math.max(0, Math.min(typeof temperature === "number" ? temperature : 0.5, 2));
      const clampedTokens = Math.max(10, Math.min(typeof maxTokens === "number" ? maxTokens : 500, 16000));

      const config = await storage.upsertRouterConfig({
        useCase,
        primaryProvider: provider,
        primaryModel: model,
        fallbackProvider: (fallbackProvider && validProviders.includes(fallbackProvider)) ? fallbackProvider : undefined,
        fallbackModel: (typeof fallbackModel === "string" && fallbackModel.length > 0) ? fallbackModel : undefined,
        timeoutMs: clampedTimeout,
        temperature: clampedTemp,
        maxTokens: clampedTokens,
        streamingEnabled: !!streamingEnabled,
      });
      const { invalidateRouterCache } = await import("./llmRouter2");
      invalidateRouterCache();
      res.json(config);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/router-config/:useCase", requireAdmin, async (req: any, res) => {
    try {
      await storage.deleteRouterConfig(req.params.useCase);
      const { invalidateRouterCache } = await import("./llmRouter2");
      invalidateRouterCache();
      res.json({ message: "Config deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/llm-metrics", requireAdmin, async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const metrics = await storage.getCallMetrics(limit);
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/meetings/:id/transcript-turn", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting || meeting.userId !== req.userId) {
        return res.status(404).json({ message: "Meeting not found" });
      }

      const text = String(req.body?.text || "").trim();
      if (!text) return res.status(400).json({ message: "text is required" });

      const recent = await storage.getRecentTranscriptTurns(req.params.id, 1);
      const nextTurnIndex = recent.length ? (recent[0].turnIndex + 1) : 0;
      const t0 = Date.now();

      const advanced = detectQuestionAdvanced(text);
      const framed = frameQuestionWindow(text);
      const cleanQuestion = framed.cleanQuestion || text.trim();
      // detectQuestionAdvanced is a superset of detectQuestion — use it exclusively to avoid double evaluation
      const isLikelyQuestion =
        framed.answerability === "complete"
        && framed.questions.length > 0
        && Math.max(advanced.confidence, framed.confidence) >= 0.72;
      const normalizedTurn = text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
      const isShortAck = /^(yes|yeah|yep|yup|correct|right|sure|i do|i did|absolutely|of course|exactly)$/i.test(normalizedTurn);

      const requestedSpeaker = String(req.body?.speaker || "").trim().toLowerCase();
      const speaker = requestedSpeaker === "interviewer" || requestedSpeaker === "candidate" || requestedSpeaker === "unknown"
        ? requestedSpeaker
        : (isLikelyQuestion ? "interviewer" : "unknown");
      const created = await storage.createTranscriptTurn({
        meetingId: req.params.id,
        turnIndex: nextTurnIndex,
        speaker,
        text,
        startMs: typeof req.body?.startMs === "number" ? req.body.startMs : null,
        endMs: typeof req.body?.endMs === "number" ? req.body.endMs : null,
        confidence: null,
        isQuestion: isLikelyQuestion,
        questionType: isLikelyQuestion ? (framed.labels[0] || advanced.type || "other") : null,
        cleanQuestion: isLikelyQuestion ? cleanQuestion : null,
      });

      if (isLikelyQuestion) {
        recordInterviewerQuestion(req.params.id, cleanQuestion || text);
        enqueueQuestion(req.params.id, cleanQuestion || text, Date.now(), {
          windowHash: framed.windowHash,
          answerability: framed.answerability,
          labels: framed.labels,
        });
      } else if (speaker === "candidate" && (isSubstantiveSegment(text) || isShortAck || text.split(/\s+/).filter(Boolean).length <= 40)) {
        recordSpokenReply(req.params.id, text);
      }

      console.log(`[perf] t0 turn_finalized meeting=${req.params.id} turn=${nextTurnIndex} dur=${Date.now() - t0}ms`);
      res.json(created);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/meetings/:id/detect-turn", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting || meeting.userId !== req.userId) {
        return res.status(404).json({ message: "Meeting not found" });
      }

      const text = String(req.body?.text || "").trim();
      if (!text) return res.status(400).json({ message: "text is required" });
      const audioMode = typeof req.body?.audioMode === "string" ? req.body.audioMode : undefined;
      const segmentKey = String(req.body?.segmentKey || "").trim();

      const recentTurns = await storage.getRecentTranscriptTurns(req.params.id, 4);
      const recentContext = recentTurns.reverse().map((t) => t.text).join("\n");
      const memoryContext = await formatMemorySlotsForPrompt(req.userId, req.params.id);
      const threshold = audioMode === "mic" ? 0.85 : 0.8;

      const result = await runDetectionPipeline(
        text,
        recentContext,
        memoryContext,
        req.params.id,
        threshold,
      );

      const framed = frameQuestionWindow(String(result.cleanQuestion || result.questionSpan || text).trim(), {
        previousQuestion: recentContext,
      });

      const shouldRecordQuestion =
        result.isQuestion
        && result.confidence >= threshold
        && framed.answerability === "complete"
        && framed.questions.length > 0;
      if (shouldRecordQuestion) {
        const detectedQuestion = framed.cleanQuestion || String(result.cleanQuestion || result.questionSpan || text).trim();
        recordInterviewerQuestion(
          req.params.id,
          detectedQuestion,
        );
        enqueueQuestion(req.params.id, detectedQuestion, Date.now(), {
          windowHash: framed.windowHash,
          answerability: framed.answerability,
          labels: framed.labels,
        });
      }

      res.json({
        is_question: result.isQuestion,
        confidence: result.confidence,
        question_span: result.questionSpan,
        clean_question: result.cleanQuestion,
        type: result.type,
        recorded: shouldRecordQuestion,
        segment_key: segmentKey || undefined,
        framed: {
          labels: framed.labels,
          answerability: framed.answerability,
          anchor: framed.anchor,
          questions: framed.questions.map((item) => ({
            text: item.text,
            labels: item.labels,
            confidence: item.confidence,
            answerability: item.answerability,
          })),
          window_hash: framed.windowHash,
          confidence: framed.confidence,
          clean_question: framed.cleanQuestion,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/meetings/:id/extract-questions", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting || meeting.userId !== req.userId) {
        return res.status(404).json({ message: "Meeting not found" });
      }

      const text = String(req.body?.text || "").trim();
      if (!text) return res.status(400).json({ message: "text is required" });

      const audioMode = req.body?.audioMode === "mic" ? "mic" : "system";
      const maxQuestions = Math.min(5, Math.max(1, Number(req.body?.maxQuestions || 5)));

      const recentTurns = await storage.getRecentTranscriptTurns(req.params.id, 4);
      const recentContext = recentTurns.reverse().map((t) => t.text).join("\n");
      const memoryContext = await formatMemorySlotsForPrompt(req.userId, req.params.id);

      const extracted = await extractQuestionsWithLLM(text, recentContext, req.params.id);
      const out: Array<{ text: string; confidence: number; clean: string }> = [];

      for (const q of extracted) {
        const rawQ = String(q.text || "").trim();
        if (!rawQ) continue;

        if (audioMode === "mic" && q.confidence < 0.8 && !detectQuestion(rawQ)) {
          continue;
        }

        const normalized = await normalizeQuestion(rawQ, recentContext, memoryContext, req.params.id);
        const clean = (normalized.cleanQuestion || rawQ).trim();
        if (!clean) continue;

        if (isDuplicateQuestion(req.params.id, normalizeForDedup(clean))) {
          continue;
        }

        out.push({
          text: rawQ,
          confidence: q.confidence,
          clean,
        });

        if (out.length >= maxQuestions) break;
      }

      res.json({
        questions: out,
        debug: { usedText: text },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/meetings/:id/compose-question", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting || meeting.userId !== req.userId) {
        return res.status(404).json({ message: "Meeting not found" });
      }

      const draft = String(req.body?.draft || "").trim();
      if (!draft) return res.status(400).json({ message: "draft is required" });

      const recentTurns = await storage.getRecentTranscriptTurns(req.params.id, 4);
      const recentContext = recentTurns.reverse().map((t) => t.text).join("\n");
      const composed = await composeQuestionWithLLM(draft, recentContext, req.params.id);

      res.json({
        final_question: composed.finalQuestion,
        is_incomplete: composed.isIncomplete,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/meetings/:id/orchestrate", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting || meeting.userId !== req.userId) {
        return res.status(404).json({ message: "Meeting not found" });
      }

      const text = String(req.body?.text || "").trim();
      const mode = req.body?.mode === "pause" || req.body?.mode === "enter" || req.body?.mode === "final"
        ? req.body.mode
        : "pause";
      const audioMode = req.body?.audioMode === "mic" ? "mic" : "system";
      const overrideQuestion = typeof req.body?.overrideQuestion === "string" ? req.body.overrideQuestion : undefined;

      if (!text) {
        return res.json({
          questions: [],
          primaryQuestion: "",
          shouldAnswerNow: false,
          action: "ignore",
          dedupeKey: "",
          confidence: 0,
        });
      }

      const state = getMeetingState(req.params.id);
      const recentFinalTexts = getRecentFinals(req.params.id, 6);
      const result = await orchestrate({
        meetingId: req.params.id,
        snapshotText: text,
        recentFinals: recentFinalTexts,
        state,
        mode,
        audioMode,
        overrideQuestion,
      });

      res.json({
        questions: result.questions,
        primaryQuestion: (result.questions[0]?.clean || result.displayQuestion || ""),
        shouldAnswerNow: result.action === "answer" || result.action === "rewrite_brief" || result.action === "rewrite_deeper",
        action: result.action,
        dedupeKey: result.dedupeKey,
        confidence: result.confidence,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/meetings/:id/set-last-answer", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting || meeting.userId !== req.userId) {
        return res.status(404).json({ message: "Meeting not found" });
      }
      const answer = String(req.body?.answer || "").trim();
      const promptUsed = String(req.body?.promptUsed || "").trim();
      if (!answer) return res.status(400).json({ message: "answer is required" });

      const state = getMeetingState(req.params.id);
      state.lastAnswer = answer;
      if (promptUsed) state.lastPrompt = promptUsed;
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/meetings/:id/set-answer-style", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting || meeting.userId !== req.userId) {
        return res.status(404).json({ message: "Meeting not found" });
      }
      const style = String(req.body?.style || "").trim();
      if (!["brief", "standard", "deep", "concise", "star", "bullet", "talking_points", "direct_followup"].includes(style)) {
        return res.status(400).json({ message: "Invalid style" });
      }
      const updated = setAnswerStyle(req.params.id, style as any);
      res.json({ ok: true, style: updated });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/meetings/:id/answer-style", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting || meeting.userId !== req.userId) {
        return res.status(404).json({ message: "Meeting not found" });
      }
      res.json({ style: getAnswerStyle(req.params.id) });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/meetings/:id/cancel-stream", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting || meeting.userId !== req.userId) {
        return res.status(404).json({ message: "Meeting not found" });
      }
      const { abortSessionStream } = await import("./assist/answerStream");
      const cancelled = abortSessionStream(req.params.id);
      res.json({ cancelled });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/meetings/:id/transcript-turns", requireAuth, async (req: any, res) => {
    try {
      const meeting = await storage.getMeeting(req.params.id);
      if (!meeting || meeting.userId !== req.userId) {
        return res.status(404).json({ message: "Meeting not found" });
      }
      const turns = await storage.getTranscriptTurns(req.params.id);
      res.json(turns);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  return httpServer;
}
