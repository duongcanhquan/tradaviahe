'use client';

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { hasRoleAccess, homePathForRole } from "@/lib/roles";

export default function ProtectedRoute({ children, allowRoles }) {
  const { user, role, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const allowKey = useMemo(
    () => (Array.isArray(allowRoles) ? allowRoles.join(",") : ""),
    [allowRoles]
  );
  const allowed = hasRoleAccess(role, allowRoles);

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
      return;
    }

    if (allowKey && role && !allowed) {
      router.replace(homePathForRole(role));
    }
  }, [allowKey, allowed, loading, pathname, role, router, user]);

  if (loading || (user && !role)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-700" />
      </div>
    );
  }

  if (!user) return null;
  if (allowKey && role && !allowed) return null;

  return children;
}
