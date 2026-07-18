'use client';

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { homePathForRole } from "@/lib/roles";

export default function HomePage() {
  const { user, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    router.replace(homePathForRole(role));
  }, [loading, role, router, user]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-700" />
    </div>
  );
}
