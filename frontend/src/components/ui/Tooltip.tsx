/**
 * Tooltip — wrapper de @radix-ui/react-tooltip con el estilo del proyecto.
 *
 * Auto-contenido (incluye su propio Provider) para poder usarse dentro de los
 * nodos/aristas de React Flow sin cablear un provider en la raiz. El contenido
 * se renderiza en un Portal a `document.body`, por encima del canvas.
 */

import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Retardo de apertura en ms (default 200). */
  delay?: number;
}

export function Tooltip({ content, children, side = "top", delay = 200 }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={delay} skipDelayDuration={400}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="z-[60] max-w-[260px] select-none rounded-md bg-ink px-2.5 py-1.5 text-xs leading-snug text-white shadow-card"
          >
            {content}
            <RadixTooltip.Arrow className="fill-ink" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
