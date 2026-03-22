import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { runMigrations } from 'stripe-replit-sync';
import { getStripeSync } from './stripeClient';
import { WebhookHandlers } from './webhookHandlers';

const app = express();
const httpServer = createServer(app);

// Allow requests from the Tauri desktop WebView (https://tauri.localhost)
// and from local dev servers. Must come before all route registration.
const ALLOWED_ORIGINS = [
  "https://tauri.localhost",   // Tauri v2 WebView2 on Windows
  "http://tauri.localhost",    // Tauri v2 WebView2 on Windows (http variant)
  "tauri://localhost",          // Tauri v2 WebView on macOS/Linux
  "http://localhost:1420",      // Tauri dev server
  "http://localhost:5173",      // Vite dev server
  "https://ai.zoommate.in",    // Production
];

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // no origin = same-origin or native
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Allow any tauri:// scheme (desktop WebView)
  if (origin.startsWith("tauri://")) return true;
  // Allow any https://tauri. origin (WebView2 variants)
  if (origin.startsWith("https://tauri.") || origin.startsWith("http://tauri.")) return true;
  // Allow localhost on any port (dev)
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

app.use(cors({
  origin: (origin, callback) => {
    callback(null, isAllowedOrigin(origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  const hasReplitToken = !!(process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL);
  const hasReplitConnector = !!process.env.REPLIT_CONNECTORS_HOSTNAME;
  const hasReplitDomains = !!process.env.REPLIT_DOMAINS;
  if (!databaseUrl || !hasReplitToken || !hasReplitConnector || !hasReplitDomains) {
    console.log('Stripe init skipped: missing Replit connector environment.');
    return;
  }

  try {
    console.log('Initializing Stripe schema...');
    await runMigrations({ databaseUrl } as any);
    console.log('Stripe schema ready');

    const stripeSync = await getStripeSync();

    console.log('Setting up managed webhook...');
    const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
    const webhookResult = await stripeSync.findOrCreateManagedWebhook(
      `${webhookBaseUrl}/api/stripe/webhook`
    );
    console.log('Webhook configured:', JSON.stringify(webhookResult?.webhook?.url || webhookResult?.url || 'OK'));

    console.log('Syncing Stripe data...');
    stripeSync.syncBackfill()
      .then(() => console.log('Stripe data synced'))
      .catch((err: any) => console.error('Error syncing Stripe data:', err));
  } catch (error) {
    console.error('Failed to initialize Stripe:', error);
  }
}

app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) return res.status(400).json({ error: 'Missing signature' });

    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      if (!Buffer.isBuffer(req.body)) {
        console.error('STRIPE WEBHOOK ERROR: req.body is not a Buffer');
        return res.status(500).json({ error: 'Webhook processing error' });
      }
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error('Webhook error:', error.message);
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
);

app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "50mb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!process.env.SESSION_SECRET) missing.push("SESSION_SECRET");
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(", ")}. Startup aborted.`);
    process.exit(1);
  }

  await initStripe();
  const { prewarmApiKey } = await import("./llmRouter");
  prewarmApiKey();
  const { seedDefaultRouterConfigs } = await import("./llmRouter2");
  seedDefaultRouterConfigs().catch(() => {});
  const { setupWsStt } = await import("./realtime/wsStt");
  setupWsStt(httpServer);
  const { setupWsAnswer } = await import("./realtime/wsAnswer");
  setupWsAnswer(httpServer);
  const { initSocket } = await import("./realtime/socket");
  initSocket(httpServer);
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
