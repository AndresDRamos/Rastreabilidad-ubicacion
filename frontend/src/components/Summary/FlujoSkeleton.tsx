import { Skeleton } from "@/components/ui/Skeleton";

/** Estado de carga del grafo de Flujo: bloques fantasma conectados por lineas
 *  atenuadas, usando la convencion estandar de Skeleton. */
export function FlujoSkeleton() {
  return (
    <div className="h-full w-full bg-surface-muted flex items-center justify-center">
      <div className="flex items-center gap-10 opacity-80">
        {[0, 1, 2].map((col) => (
          <div key={col} className="flex items-center gap-10">
            <GhostBlock />
            {col < 2 ? (
              <Skeleton className="h-0.5 w-16" />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function GhostBlock() {
  return (
    <div className="w-[260px] rounded-lg border border-surface-border bg-white shadow-soft overflow-hidden">
      <div className="px-2.5 py-1.5 border-b border-surface-border bg-surface-muted/60 flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-10" />
      </div>
      <div className="px-2.5 py-3 flex items-center gap-2">
        <Skeleton className="h-5 w-8" />
        <Skeleton className="h-3 w-3" rounded="full" />
        <Skeleton className="h-7 w-10 mx-auto" />
        <Skeleton className="h-3 w-3" rounded="full" />
        <Skeleton className="h-4 w-8" />
      </div>
    </div>
  );
}
