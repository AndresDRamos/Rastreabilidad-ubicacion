# Backend Rastreabilidad BOM API

FastAPI + pyodbc. Lee `EPS.dbo` (SQL Server) en read-only y devuelve árboles BOM netteados con WIP por proceso.

## Quick start

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
copy .env.example .env   # editar con credenciales
pytest tests/unit -v
uvicorn rbom_api.main:app --reload --port 8000
```

## Comandos

- `pytest tests/unit -v` — corre los 8 tests sintéticos del netteo (sin BD)
- `pytest -m e2e -v` — corre los tests contra la BD real (requiere `.env`)
- `uvicorn rbom_api.main:app --reload --port 8000` — dev server con hot reload
