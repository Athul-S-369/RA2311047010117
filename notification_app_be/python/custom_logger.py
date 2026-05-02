from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Mapping


class StructuredFileLogger:

    def __init__(self, service: str, log_dir: str = "logs") -> None:
        self.service = service
        self._dir = Path(log_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._path = self._dir / f"{service}-python.log"

    def _write(self, level: str, message: str, fields: Mapping[str, Any] | None = None) -> None:
        entry: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "level": level,
            "service": self.service,
            "message": message,
        }
        if fields:
            entry.update(fields)
        line = json.dumps(entry, ensure_ascii=False)
        with self._path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    def info(self, message: str, **fields: Any) -> None:
        self._write("info", message, fields)

    def warn(self, message: str, **fields: Any) -> None:
        self._write("warn", message, fields)

    def error(self, message: str, **fields: Any) -> None:
        self._write("error", message, fields)
