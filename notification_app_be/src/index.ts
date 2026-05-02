import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

{
  const envPath = path.resolve(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    loadEnv({ override: true, path: envPath });
  } else {
    loadEnv({ override: true });
  }
}

import express from "express";
import {
  createWinstonLogger,
  requestLogger,
  type RequestWithLogger,
} from "@affordmed/logging-middleware";
import { registerNotificationRoutes } from "./routes";

const SERVICE_NAME = "notification-app-be";
const PORT = Number(process.env.PORT ?? "3001");

const rootLogger = createWinstonLogger({
  serviceName: SERVICE_NAME,
  logDir: process.env.LOG_DIR ?? "logs",
  enableCliSink: false,
});

rootLogger.info("Notification backend bootstrapping", {
  port: PORT,
  evaluationAuthConfigured: Boolean(process.env.EVALUATION_AUTH_HEADER?.trim()),
});

const app = express();
app.use(express.json({ limit: "512kb" }));
app.use(
  requestLogger({
    rootLogger,
    slowRequestMs: Number(process.env.SLOW_REQUEST_MS ?? "8000"),
  })
);

registerNotificationRoutes(app, rootLogger);

app.use(
  (err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const log = (req as RequestWithLogger).log ?? rootLogger;
    log.error("Unhandled error", { message: err.message, stack: err.stack });
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    else next(err);
  }
);

app.listen(PORT, () => {
  rootLogger.info("Notification backend listening", {
    port: PORT,
    healthUrl: `http://localhost:${PORT}/health`,
    priorityTopUrl: `http://localhost:${PORT}/api/v1/notifications/priority-top`,
  });
});
