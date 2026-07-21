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
  /** Nội dung phụ trong header (vd: danh mục POS) — đẩy lên header để nhường chỗ món */
  headerExtra = null,
}) {
  const { profile, canOperateShop, isEmployee } = useAuth();
  const simple = employeeMode || isEmployee;
  const posHeader = simple && headerExtra;

  return (
    <div className="min-h-dvh text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
        <div
          className={cn(
            "mx-auto max-w-lg px-3",
            posHeader ? "py-1.5" : "px-4 py-3"
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              {!simple ? (
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700">
                  Trà Đá App
                </p>
              ) : null}
              <h1
                className={cn(
                  "truncate font-extrabold leading-tight tracking-tight text-slate-900",
                  posHeader ? "text-base" : simple ? "text-2xl" : "text-xl"
                )}
              >
                {title}
                {posHeader && subtitle ? (
                  <span className="ml-1.5 text-xs font-semibold text-slate-400">
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
                  <span className="truncate text-xs font-semibold text-slate-800">
                    {profile?.name || "—"}
                  </span>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    {displayRoleLabel(profile?.role)}
                  </span>
                </div>
              ) : null}
              <Link
                href="/settings"
                aria-label="Tài khoản"
                className={cn(
                  "flex cursor-pointer items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition duration-200 active:scale-95",
                  posHeader ? "h-9 w-9" : simple ? "h-14 w-14 rounded-2xl" : "h-12 w-12 rounded-2xl"
                )}
              >
                <Settings
                  className={posHeader ? "h-4 w-4" : simple ? "h-6 w-6" : "h-5 w-5"}
                  aria-hidden
                />
              </Link>
            </div>
          </div>

          {headerExtra ? (
            <div className={cn(posHeader ? "mt-1.5" : "mt-2")}>{headerExtra}</div>
          ) : null}
        </div>
      </header>

      <main
        className={cn(
          "mx-auto max-w-lg px-4",
          posHeader ? "pt-2" : "pt-4",
          dense ? "pb-36" : simple ? "pb-28" : "pb-nav"
        )}
      >
        {children}
      </main>
      <BottomNav />
      {/* Nhân viên đã có QR trong thanh thu — ẩn FAB để đỡ rối */}
      {canOperateShop && !simple ? <SharedQrFab /> : null}
    </div>
  );
}
