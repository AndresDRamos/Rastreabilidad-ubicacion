// Cache module-level de posiciones del layout, keyed por (idPt, expandedKey).
// Sobrevive a desmontajes del canvas (al cambiar de tab) y al fast refresh
// durante desarrollo. Si solo cambia el modo (Inventario/Requerimiento) la
// key no varia y NO se re-layoutea.

type Pos = { x: number; y: number };

const POR_KEY: Map<string, Map<string, Pos>> = new Map();

export function keyFor(idPt: number, expanded: Set<number>): string {
  const lista = [...expanded].sort((a, b) => a - b).join(",");
  return `${idPt}|${lista}`;
}

export function getCachedLayout(key: string): Map<string, Pos> | undefined {
  return POR_KEY.get(key);
}

export function setCachedLayout(key: string, posiciones: Map<string, Pos>): void {
  POR_KEY.set(key, posiciones);
}

export function dropCachedLayoutByPt(idPt: number): void {
  const prefijo = `${idPt}|`;
  for (const k of [...POR_KEY.keys()]) {
    if (k.startsWith(prefijo)) POR_KEY.delete(k);
  }
}

export function clearAllCachedLayouts(): void {
  POR_KEY.clear();
}
