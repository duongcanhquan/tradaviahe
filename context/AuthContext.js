'use client';

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { ensureUserProfile } from "@/lib/users";
import {
  canManageShop,
  canManageUsers,
  canOperateShop,
  canViewDashboard,
  homePathForRole,
} from "@/lib/roles";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (!firebaseUser) {
          setUser(null);
          setProfile(null);
          return;
        }

        setUser(firebaseUser);
        const data = await ensureUserProfile(firebaseUser);

        if (data.blocked) {
          await signOut(auth);
          setUser(null);
          setProfile(null);
          return;
        }

        setProfile(data);
      } catch (error) {
        console.error("Auth profile fetch error:", error);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const login = async (identifier, password) => {
    const { resolveLoginIdentifier } = await import("@/lib/bootstrap");
    const email = resolveLoginIdentifier(identifier);
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return credential.user;
  };

  const changePassword = async (currentPassword, newPassword) => {
    const { changeCurrentUserPassword } = await import("@/lib/bootstrap");
    await changeCurrentUserPassword(currentPassword, newPassword);
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
    setProfile(null);
  };

  const role = profile?.role || null;

  const value = useMemo(
    () => ({
      user,
      profile,
      role,
      loading,
      login,
      logout,
      changePassword,
      isSuperAdmin: role === "superadmin",
      isManager: role === "manager" || role === "superadmin",
      isEmployee: role === "employee",
      isInvestor: role === "investor",
      canManageUsers: canManageUsers(role),
      canManageShop: canManageShop(role),
      canOperateShop: canOperateShop(role),
      canViewDashboard: canViewDashboard(role),
      homePath: homePathForRole(role),
    }),
    [user, profile, role, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
