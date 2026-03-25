/**
 * Callout
 *
 * An info / warning / danger / tip block for documentation callouts.
 *
 * Usage in MDX:
 *   <Callout type="warning">Your warning text here.</Callout>
 *   <Callout type="info" title="Note">Custom title callout.</Callout>
 */

import type { ReactNode } from "react";
import { Info, TriangleAlert, OctagonX, Lightbulb } from "lucide-react";
import clsx from "clsx";

export type CalloutType = "info" | "warning" | "danger" | "tip";

interface CalloutProps {
  type?: CalloutType;
  title?: string;
  children: ReactNode;
}

const CONFIG: Record<
  CalloutType,
  {
    icon: typeof Info;
    label: string;
    containerClass: string;
    iconClass: string;
    titleClass: string;
  }
> = {
  info: {
    icon: Info,
    label: "Note",
    containerClass: "border-blue-800/60 bg-blue-950/40",
    iconClass: "text-blue-400",
    titleClass: "text-blue-300",
  },
  warning: {
    icon: TriangleAlert,
    label: "Warning",
    containerClass: "border-amber-700/60 bg-amber-950/40",
    iconClass: "text-amber-400",
    titleClass: "text-amber-300",
  },
  danger: {
    icon: OctagonX,
    label: "Danger",
    containerClass: "border-red-800/60 bg-red-950/40",
    iconClass: "text-red-400",
    titleClass: "text-red-300",
  },
  tip: {
    icon: Lightbulb,
    label: "Tip",
    containerClass: "border-emerald-800/60 bg-emerald-950/40",
    iconClass: "text-emerald-400",
    titleClass: "text-emerald-300",
  },
};

export function Callout({ type = "info", title, children }: CalloutProps) {
  const { icon: Icon, label, containerClass, iconClass, titleClass } =
    CONFIG[type];
  const displayTitle = title ?? label;

  return (
    <div
      role="note"
      aria-label={displayTitle}
      className={clsx(
        "my-6 flex gap-3 rounded-lg border p-4 text-sm",
        containerClass,
      )}
    >
      <Icon className={clsx("mt-0.5 h-4 w-4 shrink-0", iconClass)} aria-hidden />
      <div className="min-w-0">
        <p className={clsx("mb-1 font-semibold", titleClass)}>{displayTitle}</p>
        <div className="text-zinc-300 [&>p]:mb-0 [&>p:last-child]:mb-0">
          {children}
        </div>
      </div>
    </div>
  );
}
