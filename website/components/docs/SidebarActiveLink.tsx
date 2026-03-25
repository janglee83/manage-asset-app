/**
 * SidebarActiveLink
 *
 * Client island — reads `usePathname()` so the active link is highlighted
 * without running any JS on the server.  Kept minimal to reduce client bundle.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

interface SidebarActiveLinkProps {
  href: string;
  title: string;
  badge?: string;
  readingTime?: string;
}

export function SidebarActiveLink({
  href,
  title,
  badge,
}: SidebarActiveLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={clsx(
        "group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        isActive
          ? "bg-violet-600/20 text-violet-300 font-medium"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
      )}
      aria-current={isActive ? "page" : undefined}
    >
      <span className="truncate">{title}</span>
      {badge && (
        <span className="shrink-0 rounded bg-violet-600/30 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
          {badge}
        </span>
      )}
    </Link>
  );
}
