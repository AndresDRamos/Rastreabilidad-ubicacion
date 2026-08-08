"""GET /api/listados — listados de numeros criticos disponibles.

Alimenta el selector de universo del sidebar. La lista sale del manifiesto
`listados/listados.json`; el conteo de materiales, de leer cada CSV. Ambos se
cachean por mtime, asi que sobrescribir un CSV se refleja en la siguiente
llamada sin reiniciar el proceso.

No toca la BD: no lleva `Depends(get_conn)`.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..domain.modelo import ListadoInfo
from ..domain.universos import listar_listados


router = APIRouter(prefix="/api", tags=["listados"])


@router.get("/listados", response_model=list[ListadoInfo])
def get_listados() -> list[ListadoInfo]:
    """Listados disponibles como universo de filtrado.

    NO incluye "general" (sin filtro): ese no es un listado, es la ausencia de
    uno. El frontend lo antepone como opcion fija del selector.
    """
    return listar_listados()
