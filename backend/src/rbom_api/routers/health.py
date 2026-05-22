"""GET /health — ping a BD + version. No tiene prefijo /api intencionalmente."""

from __future__ import annotations

import pyodbc
from fastapi import APIRouter, Depends

from .. import __version__
from ..deps import get_conn
from ..domain import db


router = APIRouter(tags=["meta"])


@router.get("/health")
def health(conn: pyodbc.Connection = Depends(get_conn)) -> dict:
    db_ok = False
    error: str | None = None
    try:
        db_ok = db.ping(conn)
    except Exception as exc:  # noqa: BLE001 — queremos catch-all para reportar
        error = str(exc)
    return {
        "status": "ok" if db_ok else "degraded",
        "db_ok": db_ok,
        "version": __version__,
        **({"db_error": error} if error else {}),
    }
