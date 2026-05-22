"""FastAPI app factory.

Orden de mount:
  1) middlewares (correlation_id, CORS solo si DEV=true)
  2) routers /health y /api/*
  3) StaticFiles "/" en M7 (debe ir DESPUES de los routers)
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import get_settings
from .logging_setup import CorrelationIdMiddleware, configurar_logging, log
from .routers import arbol, health, pts


STATIC_DIR = Path(__file__).parent / "static"


def create_app() -> FastAPI:
    settings = get_settings()
    configurar_logging(level=settings.log_level, dev=settings.dev)

    app = FastAPI(
        title="Rastreabilidad BOM API",
        version=__version__,
        description="API para visualizar arbol BOM netteado con WIP por proceso.",
    )

    # Middlewares
    app.add_middleware(CorrelationIdMiddleware)
    if settings.dev:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
            allow_credentials=False,
            allow_methods=["GET"],
            allow_headers=["*"],
            expose_headers=["X-Correlation-Id"],
        )
        log.info("cors_enabled", origins=["http://localhost:5173"])

    # Routers
    app.include_router(health.router)
    app.include_router(pts.router)
    app.include_router(arbol.router)

    # Static frontend (build de produccion). En dev no existe; en prod copiamos
    # frontend/dist a backend/src/rbom_api/static via scripts/build.ps1. Debe
    # ir DESPUES de los routers para no interceptar /api ni /health.
    if STATIC_DIR.exists() and STATIC_DIR.is_dir():
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
        log.info("static_mounted", path=str(STATIC_DIR))

    log.info("app_ready", version=__version__, dev=settings.dev)
    return app


app = create_app()
