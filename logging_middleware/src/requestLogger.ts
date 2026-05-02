import type { NextFunction, Request, Response } from "express";
import type { AppLogger } from "./createWinstonLogger";
import { v4 as uuidv4 } from "uuid";

export const REQUEST_ID_HEADER = "x-request-id";

export interface RequestWithLogger extends Request {
  requestId: string;
  log: AppLogger;
}

export interface RequestLoggerOptions {
  rootLogger: AppLogger;
  slowRequestMs?: number;
}

export function requestLogger(options: RequestLoggerOptions) {
  const { rootLogger, slowRequestMs = 5000 } = options;

  return function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
    const headerId = req.get(REQUEST_ID_HEADER);
    const requestId = headerId && headerId.length > 0 ? headerId : uuidv4();
    (req as RequestWithLogger).requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const log = rootLogger.child({ requestId });
    (req as RequestWithLogger).log = log;

    const start = process.hrtime.bigint();
    const { method, originalUrl } = req;

    log.info("Incoming request", {
      method,
      path: originalUrl,
      ip: req.ip,
    });

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const payload = {
        method,
        path: originalUrl,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 1000) / 1000,
      };
      if (res.statusCode >= 500) {
        log.error("Request completed with server error", payload);
      } else if (res.statusCode >= 400) {
        log.warn("Request completed with client error", payload);
      } else {
        log.info("Request completed", payload);
      }
      if (durationMs > slowRequestMs) {
        log.warn("Slow request", { ...payload, slowThresholdMs: slowRequestMs });
      }
    });

    next();
  };
}
