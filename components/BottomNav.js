'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Store,
  BarChart3,
  Settings,
  Landmark,
  Wallet,
  Beaker,
  Building2,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

/** Quản lý: thu · đối soát · pha mẻ · xây dựng · cài đặt */
const managerLinks = [
  { href: "/manager/pos", label: "Thu tiền", icon: Store },
  { href: "/dashboard", label: "Đối soát", icon: BarChart3 },
  { href: "/manager/production", label: "Pha mẻ", icon: Beaker },
  { href: "/manager/construction", label: "Xây dựng", icon: Building2 },
  { href: "/settings", label: "Cài đặt", icon: Settings },
];

/**
 * Cổ đông / tài khoản quản trị: việc hằng ngày trước.
 * Cài đặt qua icon header.
 */
const ownerLinks = [
  { href: "/manager/pos", label: "Thu tiền", icon: Store },
  { href: "/dashboard", label: "Đối soát", icon: BarChart3 },
  { href: "/manager/expenses", label: "Quỹ quán", icon: Wallet },
  { href: "/manager/construction", label: "Xây dựng", icon: Building2 },
  { href: "/dashboard/capital", label: "Vốn", icon: Landmark },
];

/** Nhân viên: tối giản — màn thu + tài khoản */
const employeeLinks = [
  { href: "/manager/pos", label: "Thu tiền", icon: Store },
  { href: "/settings", label: "Tài khoản", icon: Settings },
];

function linksForRole(role) {
  if (role === "superadmin" || role === "investor") return ownerLinks;
  if (role === "employee") return employeeLinks;
  if (role === "manager") return managerLinks;
  return managerLinks;
}

export default function BottomNav() {
  const pathname = usePathname();
  const { role, user } = useAuth();

  if (!user || pathname?.startsWith("/login")) return null;

  const links = linksForRole(role);

  return (
    <nav
      aria-label="Điều hướng chính"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 backdrop-blur-md safe-bottom"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around gap-0.5 px-1 py-1.5 sm:gap-1 sm:px-2">
        {links.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/dashboard"
              ? pathname === "/dashboard" ||
                (pathname?.startsWith("/dashboard/") &&
                  !pathname?.startsWith("/dashboard/capital"))
              : href === "/dashboard/capital"
                ? pathname === href || pathname?.startsWith(`${href}/`)
                : href === "/manager/expenses"
                  ? pathname === href || pathname?.startsWith(`${href}/`)
                  : href === "/manager/production"
                    ? pathname === href || pathname?.startsWith(`${href}/`)
                    : href === "/manager/construction"
                      ? pathname === href || pathname?.startsWith(`${href}/`)
                      : pathname === href || pathname?.startsWith(`${href}/`);
          return (
            <li key={href} className="min-w-0 flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 py-2 text-[10px] font-semibold transition duration-200 active:scale-95 sm:gap-1 sm:px-1 sm:text-xs",
                  active
                    ? "bg-brand-50 text-brand-800"
                    : "text-slate-500 hover:bg-slate-50"
                )}
              >
                <Icon
                  className={cn(
                    "h-5 w-5 sm:h-6 sm:w-6",
                    active ? "stroke-[2.5]" : "stroke-2"
                  )}
                  aria-hidden
                />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
