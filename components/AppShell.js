'use client';

import Link from "next/link";
import { Settings } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import BottomNav from "@/components/BottomNav";
import { SharedQrFab } from "@/components/SharedQr";
import { roleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";

export default function AppShell({
  children,
  title,
  subtitle,
  dense = false,
  employeeMode = false,
}) {
  const { profile, canOperateShop, isEmployee } = useAuth();
  const simple = employeeMode || isEmployee;

  return (
    <div className="min-h-dvh text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            {!simple ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700">
                Trà Đá App
              </p>
            ) : null}
            <h1
              className={cn(
                "truncate font-extrabold leading-tight tracking-tight text-slate-900",
                simple ? "text-2xl" : "text-xl"
              )}
            >
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-0.5 truncate text-sm text-slate-500">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!simple ? (
              <div className="hidden max-w-[7.5rem] flex-col items-end sm:flex">
                <span className="truncate text-xs font-semibold text-slate-800">
                  {profile?.name || "—"}
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  {roleLabel(profile?.role)}
                </span>
              </div>
            ) : null}
            <Link
              href="/settings"
              aria-label="Tài khoản"
              className={cn(
                "flex cursor-pointer items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition duration-200 active:scale-95",
                simple ? "h-14 w-14" : "h-12 w-12"
              )}
            >
              <Settings className={simple ? "h-6 w-6" : "h-5 w-5"} aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      <main
        className={cn(
          "mx-auto max-w-lg px-4 pt-4",
          dense ? "pb-44" : simple ? "pb-28" : "pb-nav"
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
