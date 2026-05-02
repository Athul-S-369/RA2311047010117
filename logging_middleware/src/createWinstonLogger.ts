import * as fs from "fs";
import * as path from "path";
import winston from "winston";

const { combine, timestamp: tsFormat, errors, json, printf, colorize } = winston.format;

function ensureLogDir(logDir: string): void {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

export type AppLogger = winston.Logger;

export interface CreateLoggerOptions {
  /** Directory for log files (default: ./logs) */
  logDir?: string;
  /** Service name included in every log line */
  serviceName?: string;
  /** If true, also write human-readable lines to stderr via Winston (still not console.log in app code) */
  enableCliSink?: boolean;
}

/**
 * Creates the shared Winston logger used across the app. Application code must obtain loggers
 * from createWinstonLogger or request-scoped child loggers — not console or built-in loggers.
 */
export function createWinstonLogger(options: CreateLoggerOptions = {}): AppLogger {
  const logDir = path.resolve(options.logDir ?? "logs");
  ensureLogDir(logDir);

  const service = options.serviceName ?? "app";

  const fileCombined = path.join(logDir, `${service}-combined.log`);
  const fileError = path.join(logDir, `${service}-error.log`);

  const lineFormat = printf(({ level, message, timestamp: ts, ...meta }) => {
    const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${ts} [${level}] [${service}] ${message}${rest}`;
  });

  const transports: winston.transport[] = [
    new winston.transports.File({
      filename: fileError,
      level: "error",
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
    new winston.transports.File({
      filename: fileCombined,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
  ];

  if (options.enableCliSink) {
    transports.push(
      new winston.transports.Console({
        format: combine(colorize(), tsFormat({ format: "ISO" }), errors({ stack: true }), lineFormat),
      })
    );
  }

  return winston.createLogger({
    level: process.env.LOG_LEVEL ?? "info",
    format: combine(tsFormat({ format: "ISO" }), errors({ stack: true }), json()),
    defaultMeta: { service },
    transports,
  });
}
