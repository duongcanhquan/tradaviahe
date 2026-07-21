'use client';

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import {
  loadDeviceLogin,
  peekSavedUsername,
} from "@/lib/deviceSession";
import { homePathForRole } from "@/lib/roles";

function friendlyAuthError(error) {
  const code = error?.code || "";
  const msg = String(error?.message || "");

  if (msg.includes("Nhập tên đăng nhập") || msg.includes("đã đổi")) {
    return msg;
  }
  if (
    code === "auth/user-not-found" ||
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/invalid-login-credentials" ||
    code === "auth/invalid-email"
  ) {
    return "Sai tên hoặc mật khẩu. Hỏi quản lý tên đã tạo cho bạn.";
  }
  if (code === "auth/too-many-requests") {
    return "Thử quá nhiều lần — đợi rồi thử lại.";
  }
  if (code === "auth/network-request-failed") {
    return "Mất mạng — kiểm tra kết nối rồi thử lại.";
  }
  return "Không đăng nhập được. Gõ tên tài khoản + mật khẩu.";
}

function LoginForm() {
  const { login, user, role, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [autoLogging, setAutoLogging] = useState(false);
  const [checkingDevice, setCheckingDevice] = useState(true);
  const autoTriedRef = useRef(false);

  useEffect(() => {
    if (authLoading || !user) return;
    const next = searchParams.get("next");
    const safeNext =
      next && next.startsWith("/") && !next.startsWith("//") ? next : null;
    router.replace(safeNext || homePathForRole(role));
  }, [authLoading, role, router, searchParams, user]);

  // Prefill + tự đăng nhập lại nếu máy đã ghi nhớ
  useEffect(() => {
    if (authLoading) return;
    if (user) {
      setCheckingDevice(false);
      return;
    }
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;

    const saved = loadDeviceLogin();
    const lastName = peekSavedUsername();
    if (lastName) setIdentifier(lastName);

    if (!saved?.username || !saved?.password) {
      setCheckingDevice(false);
      return;
    }

    setPassword(saved.password);
    setRemember(true);
    setAutoLogging(true);

    (async () => {
      try {
        await login(saved.username, saved.password, { remember: true });
        showToast("Đã vào lại — máy nhớ đăng nhập", "success");
      } catch (error) {
        console.error(error);
        showToast("Máy nhớ tài khoản — bấm Đăng nhập để vào", "info");
      } finally {
        setAutoLogging(false);
        setCheckingDevice(false);
      }
    })();
  }, [authLoading, login, showToast, user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(identifier, password, { remember });
      showToast(
        remember ? "Đã vào — lần sau không cần nhập lại" : "Đăng nhập thành công",
        "success"
      );
    } catch (error) {
      console.error(error);
      showToast(friendlyAuthError(error), "error");
    } finally {
      setLoading(false);
    }
  };

  const busy = loading || authLoading || autoLogging;

  if (checkingDevice || autoLogging || authLoading) {
    return (
      <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-brand-800 px-4">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.45),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.18),transparent_35%)]" />
        <div className="relative z-10 text-center text-white">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-white/30 border-t-white" />
          <p className="text-lg font-bold">Cửa nhân viên</p>
          <p className="mt-1 text-sm text-blue-100">
            {autoLogging ? "Đang vào lại tự động..." : "Đang mở cửa..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh flex-col justify-end overflow-hidden bg-brand-800 px-4 pb-10 pt-16">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.45),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.18),transparent_35%)]" />

      <div className="relative z-10 mx-auto w-full max-w-lg">
        <div className="mb-8 text-white">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-100">
            Trà Đá App
          </p>
          <h1 className="mt-2 text-4xl font-extrabold leading-none">
            Cửa nhân viên
          </h1>
          <p className="mt-3 max-w-sm text-sm text-blue-100">
            Đăng nhập bằng <strong>tên + mật khẩu</strong>. Bật ghi nhớ nếu muốn
            máy tự vào lại lần sau.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-[28px] bg-white p-5 shadow-2xl shadow-brand-900/30"
        >
          <label className="mb-4 block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Tên đăng nhập
            </span>
            <input
              type="text"
              name="username"
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              enterKeyHint="next"
              value={identifier}
              onChange={(e) =>
                setIdentifier(
                  e.target.value.replace(/@.*/g, "").replace(/\s/g, "")
                )
              }
              className="field-input text-lg"
              placeholder="vd: nhanvien1"
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Mật khẩu
            </span>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field-input text-lg"
              placeholder="••••••••"
            />
          </label>

          <label className="mb-6 flex items-start gap-3 rounded-2xl bg-slate-50 px-3 py-3">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-1 h-5 w-5 accent-brand-700"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-800">
                Ghi nhớ trên máy này
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Lần sau mở app là vào thẳng — tắt nếu máy dùng chung.
              </span>
            </span>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="touch-btn h-16 w-full bg-brand-700 text-lg text-white disabled:opacity-60"
          >
            {loading ? "Đang vào..." : "Đăng nhập"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-brand-800">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-white" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
