'use client';

import { useEffect, useMemo, useState } from "react";
import {
  Pencil,
  Plus,
  Trash2,
  UserCog,
  Users,
  X,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import {
  createManagedUser,
  deleteManagedUser,
  subscribeUsers,
  updateManagedUser,
} from "@/lib/users";
import { ROLE_OPTIONS, roleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";

const emptyForm = {
  name: "",
  email: "",
  password: "",
  role: "employee",
  phone: "",
  note: "",
};

function roleBadgeClass(role) {
  if (role === "manager") return "bg-brand-50 text-brand-800";
  if (role === "employee") return "bg-emerald-50 text-emerald-800";
  if (role === "investor") return "bg-amber-50 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

function AdminUsersContent() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    const unsub = subscribeUsers(
      (list) => {
        setUsers(list);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được danh sách người dùng", "error");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  const filtered = useMemo(() => {
    if (filter === "all") return users;
    return users.filter((u) => u.role === filter);
  }, [filter, users]);

  const counts = useMemo(
    () => ({
      all: users.length,
      manager: users.filter((u) => u.role === "manager").length,
      employee: users.filter((u) => u.role === "employee").length,
      investor: users.filter((u) => u.role === "investor").length,
    }),
    [users]
  );

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      name: row.name || "",
      email: row.email || "",
      password: "",
      role: row.role || "employee",
      phone: row.phone || "",
      note: row.note || "",
    });
    setModalOpen(true);
  };

  const closeModal = (force = false) => {
    if (saving && !force) return;
    setModalOpen(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast("Nhập họ tên", "error");
      return;
    }
    if (!editing && (!form.email.trim() || !form.password || form.password.length < 6)) {
      showToast("Email và mật khẩu (≥6 ký tự) bắt buộc khi thêm mới", "error");
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await updateManagedUser(editing.uid || editing.id, {
          name: form.name,
          role: form.role,
          phone: form.phone,
          note: form.note,
        });
        showToast("Đã cập nhật người dùng", "success");
      } else {
        await createManagedUser({
          email: form.email,
          password: form.password,
          name: form.name,
          role: form.role,
          phone: form.phone,
          note: form.note,
          createdBy: user.uid,
        });
        showToast("Đã thêm người dùng", "success");
      }
      setSaving(false);
      closeModal(true);
    } catch (error) {
      console.error(error);
      const code = error?.code || "";
      if (code === "auth/email-already-in-use") {
        showToast("Email đã tồn tại trên Auth", "error");
      } else if (code === "auth/invalid-email") {
        showToast("Email không hợp lệ", "error");
      } else if (code === "auth/weak-password") {
        showToast("Mật khẩu quá yếu", "error");
      } else {
        showToast(editing ? "Cập nhật thất bại" : "Thêm người dùng thất bại", "error");
      }
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if ((row.uid || row.id) === user.uid) {
      showToast("Không thể xóa chính bạn", "error");
      return;
    }
    const ok = window.confirm(
      `Xóa "${row.name || row.email}" khỏi hệ thống?\n(Hồ sơ Firestore sẽ bị xóa; tài khoản Auth có thể vẫn còn.)`
    );
    if (!ok) return;

    setDeletingId(row.uid || row.id);
    try {
      await deleteManagedUser(row.uid || row.id);
      showToast("Đã xóa người dùng", "success");
    } catch (error) {
      console.error(error);
      showToast("Xóa thất bại", "error");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AppShell title="Admin" subtitle="Nhân viên · Quản lý · Chủ đầu tư">
      <section className="mb-4 grid grid-cols-2 gap-2">
        {[
          { key: "all", label: "Tất cả", count: counts.all },
          { key: "manager", label: "Quản lý", count: counts.manager },
          { key: "employee", label: "Nhân viên", count: counts.employee },
          { key: "investor", label: "Chủ ĐT", count: counts.investor },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            className={cn(
              "card-panel flex min-h-14 cursor-pointer items-center justify-between gap-2 py-3 transition duration-200 active:scale-95",
              filter === item.key && "border-brand-700 bg-brand-50 ring-2 ring-brand-700/20"
            )}
          >
            <span className="text-sm font-semibold">{item.label}</span>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
              {item.count}
            </span>
          </button>
        ))}
      </section>

      <button
        type="button"
        onClick={openCreate}
        className="touch-btn mb-4 h-14 w-full bg-brand-700 text-white"
      >
        <Plus className="h-5 w-5" aria-hidden />
        Thêm người dùng
      </button>

      <section className="space-y-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card-panel h-24 animate-pulse bg-slate-100" />
          ))
        ) : filtered.length === 0 ? (
          <div className="card-panel flex flex-col items-center gap-2 py-10 text-slate-500">
            <Users className="h-8 w-8" />
            <p>Chưa có người dùng trong nhóm này</p>
          </div>
        ) : (
          filtered.map((row) => {
            const id = row.uid || row.id;
            const isSelf = id === user.uid;
            return (
              <article key={id} className="card-panel space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">
                      {row.name || "Không tên"}
                      {isSelf ? (
                        <span className="ml-2 text-xs font-medium text-slate-400">
                          (bạn)
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-sm text-slate-500">{row.email}</p>
                    {row.phone ? (
                      <p className="text-xs text-slate-400">{row.phone}</p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                      roleBadgeClass(row.role)
                    )}
                  >
                    {roleLabel(row.role)}
                  </span>
                </div>

                {row.note ? (
                  <p className="text-xs text-slate-500">{row.note}</p>
                ) : null}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
                    className="touch-btn h-12 flex-1 gap-2 bg-slate-900 text-white"
                  >
                    <Pencil className="h-4 w-4" />
                    Sửa
                  </button>
                  <button
                    type="button"
                    disabled={isSelf || deletingId === id}
                    onClick={() => handleDelete(row)}
                    className="touch-btn h-12 flex-1 gap-2 bg-rose-600 text-white disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                    {deletingId === id ? "..." : "Xóa"}
                  </button>
                </div>
              </article>
            );
          })
        )}
      </section>

      {modalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-end bg-slate-950/50 p-4 sm:items-center sm:justify-center">
          <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <UserCog className="h-5 w-5 text-brand-700" />
                <h2 className="text-lg font-bold">
                  {editing ? "Sửa người dùng" : "Thêm người dùng"}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 transition-transform active:scale-95"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  Họ tên
                </span>
                <input
                  required
                  className="field-input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Nguyễn Văn A"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  Vai trò
                </span>
                <select
                  className="field-input"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              {!editing ? (
                <>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">
                      Email đăng nhập
                    </span>
                    <input
                      type="email"
                      required
                      className="field-input"
                      value={form.email}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, email: e.target.value }))
                      }
                      placeholder="email@example.com"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">
                      Mật khẩu tạm
                    </span>
                    <input
                      type="password"
                      required
                      minLength={6}
                      className="field-input"
                      value={form.password}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, password: e.target.value }))
                      }
                      placeholder="Tối thiểu 6 ký tự"
                    />
                  </label>
                </>
              ) : (
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  Email: <strong className="text-slate-700">{form.email}</strong>
                  <br />
                  (Không đổi email / mật khẩu tại đây)
                </div>
              )}

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  Số điện thoại
                </span>
                <input
                  className="field-input"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="09..."
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  Ghi chú
                </span>
                <input
                  className="field-input"
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="Ví dụ: cổ đông 25%, ca tối..."
                />
              </label>

              <button
                type="submit"
                disabled={saving}
                className="touch-btn h-14 w-full bg-brand-700 text-white disabled:opacity-50"
              >
                {saving
                  ? "Đang lưu..."
                  : editing
                    ? "Lưu thay đổi"
                    : "Tạo tài khoản"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

export default function AdminUsersPage() {
  return (
    <ProtectedRoute allowRoles={["manager"]}>
      <AdminUsersContent />
    </ProtectedRoute>
  );
}
