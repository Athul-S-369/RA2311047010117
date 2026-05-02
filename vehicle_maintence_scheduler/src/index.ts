import express from "express";
import {
  createWinstonLogger,
  requestLogger,
  type RequestWithLogger,
} from "@affordmed/logging-middleware";
import { registerRoutes } from "./routes";

const SERVICE_NAME = "vehicle-maintence-scheduler";
const PORT = Number(process.env.PORT ?? "3000");

const rootLogger = createWinstonLogger({
  serviceName: SERVICE_NAME,
  logDir: process.env.LOG_DIR ?? "logs",
  enableCliSink: process.env.LOG_CLI === "1" || process.env.LOG_CLI === "true",
});

rootLogger.info("Vehicle scheduling service bootstrapping", {
  port: PORT,
  logCli: process.env.LOG_CLI === "1" || process.env.LOG_CLI === "true",
});

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(
  requestLogger({
    rootLogger,
    slowRequestMs: Number(process.env.SLOW_REQUEST_MS ?? "8000"),
  })
);

registerRoutes(app, rootLogger);

app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const log = (req as RequestWithLogger).log ?? rootLogger;
    log.error("Unhandled error", { message: err.message, stack: err.stack });
    if (res.headersSent) {
      next(err);
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
);

app.listen(PORT, () => {
  rootLogger.info("Vehicle scheduling service listening", {
    port: PORT,
    healthUrl: `http://localhost:${PORT}/health`,
    scheduleUrl: `http://localhost:${PORT}/api/v1/schedule/optimal`,
  });
});
