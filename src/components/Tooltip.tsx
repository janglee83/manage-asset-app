/**
 * Tooltip — wraps any element and shows a styled tooltip on hover.
 *
 * Usage:
 *   <Tooltip text="Explain the thing">
 *     <button>…</button>
 *   </Tooltip>
 *
 * If `text` is undefined/empty the children are rendered as-is (no wrapper overhead).
 */

import { useState, useRef, useCallback } from "react";
import clsx from "clsx";

interface TooltipProps {
  /** Tooltip text. Pass undefined to skip tooltip entirely. */
  text?: string;
  /** Position preference (default: "top"). */
  position?: "top" | "bottom" | "left" | "right";
  children: React.ReactNode;
  /** Extra class on the wrapping span. */
  className?: string;
}

export function Tooltip({ text, position = "top", children, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timeoutRef.current = setTimeout(() => setVisible(true), 400);
  }, []);

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
  }, []);

  // No tooltip text — render children directly to avoid DOM overhead.
  if (!text) return <>{children}</>;

  const posClass = {
    top:    "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
    bottom: "top-full  left-1/2 -translate-x-1/2 mt-1.5",
    left:   "right-full top-1/2 -translate-y-1/2 mr-1.5",
    right:  "left-full  top-1/2 -translate-y-1/2 ml-1.5",
  }[position];

  return (
    <span
      className={clsx("relative inline-flex", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={clsx(
            "pointer-events-none absolute z-[200] w-max max-w-[220px] rounded-md px-2.5 py-1.5",
            "bg-slate-700 border border-slate-600 text-slate-100 text-[11px] leading-snug",
            "shadow-xl whitespace-normal",
            posClass,
          )}
        >
          {text}
        </span>
      )}
    </span>
  );
}
