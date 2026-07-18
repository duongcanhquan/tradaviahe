'use client';

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { homePathForRole } from "@/lib/roles";

export default function ProtectedRoute({ children, allowRoles }) {
  const { user, role, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
      return;
    }

    if (allowRoles?.length && role && !allowRoles.includes(role)) {
      router.replace(homePathForRole(role));
    }
  }, [allowRoles, loading, pathname, role, router, user]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-700" />
      </div>
    );
  }

  if (!user) return null;
  if (allowRoles?.length && role && !allowRoles.includes(role)) return null;

  return children;
}
