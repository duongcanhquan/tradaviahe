'use client';

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { ensureUserProfile } from "@/lib/users";
import {
  extractUsername,
  usernameToEmail,
} from "@/lib/authIdentity";
import {
  clearDeviceLogin,
  rememberLastUsername,
  saveDeviceLogin,
} from "@/lib/deviceSession";
import {
  canCloseShift,
  canEnterIncome,
  canManageAssets,
  canManageEmployees,
  canManageShop,
  canManageSystem,
  canManageUsers,
  canOperateShop,
  canViewDashboard,
  canViewInvestmentCapital,
  homePathForRole,
} from "@/lib/roles";

const AuthContext = createContext(null);

function fallbackProfile(firebaseUser) {
  const email = firebaseUser?.email || "";
  const username = extractUsername(email) || "user";
  return {
    uid: firebaseUser.uid,
    email,
    username,
    name: username,
    role: username === "canhquan" ? "superadmin" : "employee",
    active: true,
  };
}

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
        try {
          const data = await ensureUserProfile(firebaseUser);
          if (data.blocked) {
            clearDeviceLogin();
            await signOut(auth);
            setUser(null);
            setProfile(null);
            return;
          }
          setProfile(data);
        } catch (profileError) {
          // Firestore lỗi vẫn cho vào app với hồ sơ tạm — không kẹt màn login
          console.error("Auth profile fetch error:", profileError);
          setProfile(fallbackProfile(firebaseUser));
        }
      } catch (error) {
        console.error("Auth state error:", error);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  /** Đăng nhập bằng TÊN — map sang email nội bộ, không hỏi email */
  const login = async (identifier, password, options = {}) => {
    const { remember = true } = options;
    const username = extractUsername(identifier);
    if (!username) {
      throw new Error("Nhập tên đăng nhập");
    }
    const authEmail = usernameToEmail(username);
    const credential = await signInWithEmailAndPassword(
      auth,
      authEmail,
      password
    );
    rememberLastUsername(username);
    if (remember) {
      saveDeviceLogin({ username, password });
    } else {
      clearDeviceLogin();
    }
    return credential.user;
  };

  const changePassword = async (currentPassword, newPassword) => {
    const { changeCurrentUserPassword } = await import("@/lib/bootstrap");
    await changeCurrentUserPassword(currentPassword, newPassword);
    const username =
      profile?.username || extractUsername(user?.email || "") || "";
    if (username) {
      saveDeviceLogin({ username, password: newPassword });
    }
  };

  const logout = async () => {
    clearDeviceLogin();
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
      isManager: role === "manager",
      isEmployee: role === "employee",
      isInvestor: role === "investor",
      canManageUsers: canManageUsers(role),
      canManageEmployees: canManageEmployees(role),
      canManageSystem: canManageSystem(role),
      canManageShop: canManageShop(role),
      canManageAssets: canManageAssets(role),
      canViewInvestmentCapital: canViewInvestmentCapital(role),
      canOperateShop: canOperateShop(role),
      canEnterIncome: canEnterIncome(role),
      canCloseShift: canCloseShift(role),
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
