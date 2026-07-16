/**
 * Skeleton — primitiva de carga estandar del proyecto.
 *
 * Convencion: cualquier campo cuyo valor aun se esta calculando se tapa con un
 * rectangulo atenuado y animado (pulse) en vez de mostrar 0 o saltar de layout.
 * Usar `Skeleton` para bloques genericos y `NumberSkeleton` para tapar un campo
 * numerico manteniendo el ancho tabular.
 */

interface SkeletonProps {
  className?: string;
  /** Forma redondeada (default) o circular. */
  rounded?: "md" | "full";
}

export function Skeleton({ className = "", rounded = "md" }: SkeletonProps) {
  const r = rounded === "full" ? "rounded-full" : "rounded";
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-pulse bg-surface-subtle ${r} ${className}`}
    />
  );
}

interface NumberSkeletonProps {
  /** Ancho aproximado en caracteres (ch). Default 3. */
  chars?: number;
  className?: string;
}

/** Tapa un valor numerico mientras se recalcula, conservando la altura/anchura. */
export function NumberSkeleton({ chars = 3, className = "" }: NumberSkeletonProps) {
  return (
    <span
      aria-hidden="true"
      style={{ width: `${chars}ch` }}
      className={`inline-block h-[1em] align-middle animate-pulse rounded bg-surface-subtle ${className}`}
    />
  );
}
