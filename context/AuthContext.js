'use client';

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
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
        const snap = await getDoc(doc(db, "users", firebaseUser.uid));
        if (snap.exists()) {
          const data = snap.data();
          if (data.active === false) {
            await signOut(auth);
            setUser(null);
            setProfile(null);
            return;
          }
          setProfile({ uid: firebaseUser.uid, ...data });
        } else {
          setProfile({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            name: firebaseUser.email?.split("@")[0] || "Người dùng",
            role: "manager",
            active: true,
          });
        }
      } catch (error) {
        console.error("Auth profile fetch error:", error);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const login = async (email, password) => {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return credential.user;
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
      isManager: role === "manager",
      isEmployee: role === "employee",
      isInvestor: role === "investor",
      canManageUsers: canManageUsers(role),
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
