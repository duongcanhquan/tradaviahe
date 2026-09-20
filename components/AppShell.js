'use client';

import Link from "next/link";
import { Settings } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import BottomNav from "@/components/BottomNav";
import { SharedQrFab } from "@/components/SharedQr";
import { displayRoleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";

export default function AppShell({
  children,
  title,
  subtitle,
  dense = false,
  employeeMode = false,
  headerExtra = null,
}) {
  const { profile, canOperateShop, isEmployee } = useAuth();
  const simple = employeeMode || isEmployee;
  const posHeader = simple && headerExtra;

  return (
    <div className="min-h-dvh text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/92 backdrop-blur-xl">
        <div
          className={cn(
            "mx-auto max-w-lg",
            posHeader ? "px-3 py-2" : "px-4 py-3"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              {!simple ? (
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand-700">
                  Trà Đá App
                </p>
              ) : null}
              <h1
                className={cn(
                  "truncate font-bold leading-tight tracking-tight text-slate-900",
                  posHeader ? "text-base" : "text-lg"
                )}
              >
                {title}
                {posHeader && subtitle ? (
                  <span className="ml-1.5 text-sm font-bold text-slate-400">
                    · {subtitle}
                  </span>
                ) : null}
              </h1>
              {subtitle && !posHeader ? (
                <p className="mt-0.5 truncate text-sm text-slate-500">
                  {subtitle}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!simple ? (
                <div className="hidden max-w-[7.5rem] flex-col items-end sm:flex">
                  <span className="truncate text-xs font-bold text-slate-800">
                    {profile?.name || "—"}
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    {displayRoleLabel(profile?.role)}
                  </span>
                </div>
              ) : null}
              <Link
                href="/settings"
                aria-label="Tài khoản"
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition duration-200 active:scale-95"
              >
                <Settings className="h-5 w-5" aria-hidden />
              </Link>
            </div>
          </div>

          {headerExtra ? (
            <div className={cn(posHeader ? "mt-2" : "mt-3")}>{headerExtra}</div>
          ) : null}
        </div>
      </header>

      <main
        className={cn(
          "mx-auto max-w-lg px-4",
          posHeader ? "pt-3" : "pt-4",
          dense ? "pb-36" : simple ? "pb-28" : "pb-nav"
        )}
      >
        {children}
      </main>
      <BottomNav />
      {canOperateShop && !simple ? <SharedQrFab /> : null}
    </div>
  );
}
