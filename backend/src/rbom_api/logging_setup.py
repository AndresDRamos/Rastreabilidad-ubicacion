"""Configuracion de structlog + middleware de correlation_id.

Dev:  ConsoleRenderer con colores.
Prod: JSONRenderer (apto para consumo por Loki/Splunk).

Cada request recibe un ``correlation_id`` (uuid4) inyectado al contextvars de
structlog y devuelto en el header ``X-Correlation-Id``. Asi cualquier log
emitido durante el procesamiento del request queda ligado.
"""

from __future__ import annotations

import logging
import sys
import time
import uuid
from typing import Callable

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


def configurar_logging(level: str = "INFO", dev: bool = False) -> None:
    """Inicializa structlog. Llamar UNA vez al arrancar la app."""
    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=False)

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        timestamper,
    ]

    if dev:
        renderer = structlog.dev.ConsoleRenderer(colors=True)
    else:
        renderer = structlog.processors.JSONRenderer()

    structlog.configure(
        processors=shared_processors + [renderer],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )

    # Silenciar el access log default de uvicorn (lo manejamos nosotros).
    logging.getLogger("uvicorn.access").disabled = True


log = structlog.get_logger("rbom_api")


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Inyecta un correlation_id por request y emite request_start/end."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        cid = request.headers.get("X-Correlation-Id") or uuid.uuid4().hex
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            correlation_id=cid,
            method=request.method,
            path=request.url.path,
        )

        t0 = time.perf_counter()
        log.info("request_start")
        try:
            response = await call_next(request)
        except Exception:
            elapsed_ms = (time.perf_counter() - t0) * 1000
            log.exception("request_error", duration_ms=round(elapsed_ms, 2))
            raise

        elapsed_ms = (time.perf_counter() - t0) * 1000
        response.headers["X-Correlation-Id"] = cid
        log.info(
            "request_end",
            status_code=response.status_code,
            duration_ms=round(elapsed_ms, 2),
        )
        return response
