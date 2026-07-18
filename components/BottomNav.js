'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Store,
  ClipboardCheck,
  BarChart3,
  Settings,
  UserCog,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

const managerLinks = [
  { href: "/manager/pos", label: "POS", icon: Store },
  { href: "/manager/inventory", label: "Chốt Ca", icon: ClipboardCheck },
  { href: "/dashboard", label: "Đối soát", icon: BarChart3 },
  { href: "/admin/users", label: "Admin", icon: UserCog },
];

const employeeLinks = [
  { href: "/manager/pos", label: "POS", icon: Store },
  { href: "/manager/inventory", label: "Chốt Ca", icon: ClipboardCheck },
  { href: "/settings", label: "Cài đặt", icon: Settings },
];

const investorLinks = [
  { href: "/dashboard", label: "Đối soát", icon: BarChart3 },
  { href: "/settings", label: "Cài đặt", icon: Settings },
];

function linksForRole(role) {
  if (role === "investor") return investorLinks;
  if (role === "employee") return employeeLinks;
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
      <ul className="mx-auto flex max-w-lg items-stretch justify-around gap-1 px-2 py-1.5">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(`${href}/`);
          return (
            <li key={href} className="min-w-0 flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-semibold transition duration-200 active:scale-95 sm:text-xs",
                  active
                    ? "bg-brand-50 text-brand-800"
                    : "text-slate-500 hover:bg-slate-50"
                )}
              >
                <Icon
                  className={cn("h-6 w-6", active ? "stroke-[2.5]" : "stroke-2")}
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
