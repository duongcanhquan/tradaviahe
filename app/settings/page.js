'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import Link from "next/link";
import { LogOut, PackagePlus, UserCog, UserPlus } from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { db } from "@/lib/firebase";
import { formatCurrency } from "@/lib/utils";
import { roleLabel } from "@/lib/roles";

const SAMPLE_PRODUCTS = [
  { name: "Trà đá", price: 5000, cost: 1000, inStock: 100 },
  { name: "Trà chanh", price: 10000, cost: 3000, inStock: 50 },
  { name: "Cà phê đá", price: 15000, cost: 5000, inStock: 40 },
  { name: "Nước ngọt", price: 12000, cost: 8000, inStock: 30 },
];

function SettingsContent() {
  const { profile, logout, isManager, canManageUsers, user } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const [seeding, setSeeding] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseNote, setExpenseNote] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("nhập nguyên liệu");
  const [savingExpense, setSavingExpense] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
      showToast("Đã đăng xuất", "info");
      router.replace("/login");
    } catch (error) {
      console.error(error);
      showToast("Đăng xuất thất bại", "error");
    }
  };

  const seedProducts = async () => {
    setSeeding(true);
    try {
      const existing = await getDocs(collection(db, "products"));
      if (!existing.empty) {
        showToast("Đã có sản phẩm, không seed lại", "info");
        return;
      }
      await Promise.all(
        SAMPLE_PRODUCTS.map((p) => addDoc(collection(db, "products"), p))
      );
      showToast("Đã thêm sản phẩm mẫu", "success");
    } catch (error) {
      console.error(error);
      showToast("Seed sản phẩm thất bại", "error");
    } finally {
      setSeeding(false);
    }
  };

  const ensureUserProfile = async () => {
    try {
      await setDoc(
        doc(db, "users", user.uid),
        {
          uid: user.uid,
          email: user.email,
          name: profile?.name || user.email?.split("@")[0] || "Người dùng",
          role: profile?.role || "manager",
        },
        { merge: true }
      );
      showToast("Đã đồng bộ hồ sơ users", "success");
    } catch (error) {
      console.error(error);
      showToast("Không lưu được hồ sơ", "error");
    }
  };

  const addExpense = async (e) => {
    e.preventDefault();
    setSavingExpense(true);
    try {
      await addDoc(collection(db, "transactions"), {
        amount: Number(expenseAmount) || 0,
        type: "expense",
        category: expenseCategory,
        timestamp: serverTimestamp(),
        createdBy: user.uid,
        note: expenseNote || "",
        paymentMethod: "cash",
      });
      setExpenseAmount("");
      setExpenseNote("");
      showToast("Đã ghi khoản chi", "success");
    } catch (error) {
      console.error(error);
      showToast("Ghi chi thất bại", "error");
    } finally {
      setSavingExpense(false);
    }
  };

  useEffect(() => {
    // no-op placeholder for future investor preferences
  }, []);

  return (
    <AppShell title="Cài đặt" subtitle="Tài khoản & tiện ích">
      <section className="card-panel mb-4 space-y-2">
        <p className="text-sm text-slate-500">Đang đăng nhập</p>
        <p className="text-lg font-bold">{profile?.name || "—"}</p>
        <p className="text-sm text-slate-600">{profile?.email}</p>
        <p className="inline-flex rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800">
          Vai trò: {roleLabel(profile?.role)}
        </p>
      </section>

      {canManageUsers ? (
        <Link
          href="/admin/users"
          className="touch-btn mb-4 h-14 w-full gap-2 bg-brand-700 text-white"
        >
          <UserCog className="h-5 w-5" />
          Admin — Quản lý người dùng
        </Link>
      ) : null}

      <section className="card-panel mb-4 space-y-3">
        <h2 className="font-bold">Hồ sơ Firestore</h2>
        <p className="text-sm text-slate-500">
          Document <code>users/{user?.uid}</code> dùng role:{" "}
          <code>manager</code>, <code>employee</code>, hoặc <code>investor</code>.
        </p>
        <button
          type="button"
          onClick={ensureUserProfile}
          className="touch-btn h-12 w-full gap-2 bg-slate-900 text-white"
        >
          <UserPlus className="h-5 w-5" />
          Đồng bộ hồ sơ hiện tại
        </button>
      </section>

      {isManager ? (
        <>
          <section className="card-panel mb-4 space-y-3">
            <h2 className="font-bold">Dữ liệu mẫu</h2>
            <button
              type="button"
              disabled={seeding}
              onClick={seedProducts}
              className="touch-btn h-12 w-full gap-2 bg-brand-700 text-white disabled:opacity-50"
            >
              <PackagePlus className="h-5 w-5" />
              {seeding ? "Đang seed..." : "Seed sản phẩm mẫu"}
            </button>
            <ul className="space-y-1 text-xs text-slate-500">
              {SAMPLE_PRODUCTS.map((p) => (
                <li key={p.name}>
                  {p.name} — {formatCurrency(p.price)} · tồn {p.inStock}
                </li>
              ))}
            </ul>
          </section>

          <section className="card-panel mb-4">
            <h2 className="mb-3 font-bold">Ghi khoản chi</h2>
            <form onSubmit={addExpense} className="space-y-3">
              <select
                className="field-input"
                value={expenseCategory}
                onChange={(e) => setExpenseCategory(e.target.value)}
              >
                <option value="nhập nguyên liệu">nhập nguyên liệu</option>
                <option value="trả lương">trả lương</option>
                <option value="khác">khác</option>
              </select>
              <input
                type="number"
                required
                className="field-input"
                placeholder="Số tiền"
                value={expenseAmount}
                onChange={(e) => setExpenseAmount(e.target.value)}
              />
              <input
                type="text"
                className="field-input"
                placeholder="Ghi chú"
                value={expenseNote}
                onChange={(e) => setExpenseNote(e.target.value)}
              />
              <button
                type="submit"
                disabled={savingExpense}
                className="touch-btn h-12 w-full bg-rose-600 text-white disabled:opacity-50"
              >
                {savingExpense ? "Đang lưu..." : "Lưu khoản chi"}
              </button>
            </form>
          </section>
        </>
      ) : null}

      <button
        type="button"
        onClick={handleLogout}
        className="touch-btn h-14 w-full gap-2 border border-slate-200 bg-white text-slate-800"
      >
        <LogOut className="h-5 w-5" />
        Đăng xuất
      </button>
    </AppShell>
  );
}

export default function SettingsPage() {
  return (
    <ProtectedRoute allowRoles={["manager", "employee", "investor"]}>
      <SettingsContent />
    </ProtectedRoute>
  );
}
