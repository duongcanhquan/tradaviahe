'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Store,
  BarChart3,
  Settings,
  Wallet,
  Warehouse,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

/** Thu tiền · quỹ · đối soát · kho. Món bán nằm trong Kho. Vốn mở từ Đối soát. */
const shopLinks = [
  { href: "/manager/pos", label: "Thu tiền", icon: Store },
  { href: "/manager/expenses", label: "Quỹ quán", icon: Wallet },
  { href: "/dashboard", label: "Đối soát", icon: BarChart3 },
  { href: "/manager/inventory", label: "Kho", icon: Warehouse },
];

/** Nhân viên: tối giản — màn thu + tài khoản */
const employeeLinks = [
  { href: "/manager/pos", label: "Thu tiền", icon: Store },
  { href: "/settings", label: "Tài khoản", icon: Settings },
];

function linksForRole(role) {
  if (role === "employee") return employeeLinks;
  return shopLinks;
}

export default function BottomNav() {
  const pathname = usePathname();
  const { role, user } = useAuth();

  if (!user || pathname?.startsWith("/login")) return null;

  const links = linksForRole(role);

  return (
    <nav
      aria-label="Điều hướng chính"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200/80 bg-white/95 shadow-[0_-8px_24px_rgb(15_23_42_/_0.06)] backdrop-blur-xl safe-bottom"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around gap-0.5 px-2 py-1.5">
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
                  : href === "/manager/inventory"
                    ? pathname === "/manager/inventory" ||
                      pathname?.startsWith("/manager/inventory/") ||
                      pathname === "/manager/products" ||
                      pathname?.startsWith("/manager/products/")
                    : pathname === href || pathname?.startsWith(`${href}/`);
          return (
            <li key={href} className="min-w-0 flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[3.5rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl px-0.5 py-2 text-xs font-bold transition duration-200 active:scale-95",
                  active
                    ? "bg-brand-50 text-brand-800 ring-1 ring-brand-700/10"
                    : "text-slate-500"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-xl transition duration-200",
                    active ? "bg-brand-700 text-white shadow-sm" : "text-slate-500"
                  )}
                >
                  <Icon
                    className="h-5 w-5"
                    strokeWidth={active ? 2.5 : 2}
                    aria-hidden
                  />
                </span>
                <span className="truncate leading-none">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
