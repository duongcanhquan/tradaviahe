export const ROLES = {
  superadmin: "superadmin",
  manager: "manager",
  employee: "employee",
  investor: "investor",
};

export const ROLE_LABELS = {
  superadmin: "Super Admin",
  manager: "Quản lý",
  employee: "Nhân viên",
  investor: "Chủ đầu tư",
};

/**
 * Vai trò có thể gán khi thêm/sửa user (không gồm superadmin).
 * Mô tả quyền theo yêu cầu nghiệp vụ.
 */
export const ROLE_OPTIONS = [
  {
    value: "manager",
    label: "Quản lý",
    description:
      "Nhập/xuất hàng, chi tiêu, nhập tiền, quản lý nhân viên, POS & chốt ca",
  },
  {
    value: "employee",
    label: "Nhân viên",
    description: "Bán hàng POS và chốt ca",
  },
  {
    value: "investor",
    label: "Chủ đầu tư",
    description:
      "Xem vốn đầu tư ban đầu và quản lý toàn bộ hệ thống (trừ Admin người dùng)",
  },
];

export const QUICK_ADD_ROLES = [
  { value: "employee", label: "Thêm nhân viên", tone: "emerald" },
  { value: "investor", label: "Thêm chủ đầu tư", tone: "amber" },
  { value: "manager", label: "Thêm quản lý", tone: "brand" },
];

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || "—";
}

/** Super Admin: quản lý người dùng + Admin (xem/reset mật khẩu) */
export function canManageUsers(role) {
  return role === "superadmin";
}

/**
 * Quản lý nhân viên (thêm/sửa/xóa nhân viên).
 * Quản lý + Chủ ĐT + Super Admin.
 */
export function canManageEmployees(role) {
  return (
    role === "superadmin" || role === "investor" || role === "manager"
  );
}

/** Chủ đầu tư + Super Admin: quản lý toàn bộ hệ thống */
export function canManageSystem(role) {
  return role === "superadmin" || role === "investor";
}

/** Bán hàng / chốt ca / QR */
export function canOperateShop(role) {
  return (
    role === "superadmin" ||
    role === "investor" ||
    role === "manager" ||
    role === "employee"
  );
}

/** Dashboard tài chính + vốn góp (xem) */
export function canViewDashboard(role) {
  return (
    role === "superadmin" || role === "investor" || role === "manager"
  );
}

/**
 * Vận hành tài chính quán: nhập/xuất hàng liên quan, chi tiêu,
 * nhập tiền/vốn, seed, cấu hình quỹ.
 */
export function canManageShop(role) {
  return (
    role === "superadmin" || role === "investor" || role === "manager"
  );
}

/** Vai trò actor được phép gán cho user mới/sửa */
export function assignableRolesFor(actorRole) {
  if (actorRole === "superadmin" || actorRole === "investor") {
    return ROLE_OPTIONS;
  }
  if (actorRole === "manager") {
    return ROLE_OPTIONS.filter((opt) => opt.value === "employee");
  }
  return [];
}

/** Quick-add buttons theo quyền actor */
export function quickAddRolesFor(actorRole) {
  if (actorRole === "manager") {
    return QUICK_ADD_ROLES.filter((r) => r.value === "employee");
  }
  if (actorRole === "superadmin" || actorRole === "investor") {
    return QUICK_ADD_ROLES;
  }
  return [];
}

/** Actor có được tạo/sửa/xóa target không */
export function canEditTargetUser(actorRole, targetRole) {
  if (!actorRole || !targetRole) return false;
  if (targetRole === "superadmin") {
    return actorRole === "superadmin";
  }
  if (actorRole === "superadmin" || actorRole === "investor") {
    return true;
  }
  if (actorRole === "manager") {
    return targetRole === "employee";
  }
  return false;
}

export function canAssignRole(actorRole, targetRole) {
  return assignableRolesFor(actorRole).some((opt) => opt.value === targetRole);
}

export function homePathForRole(role) {
  if (role === "investor") return "/dashboard";
  if (role === "employee") return "/manager/pos";
  if (role === "superadmin") return "/admin/users";
  if (role === "manager") return "/manager/pos";
  return "/manager/pos";
}

/**
 * Super Admin đi qua mọi route được bảo vệ.
 * Role khác phải nằm trong allowRoles (gán rõ trên từng trang).
 */
export function hasRoleAccess(userRole, allowRoles) {
  if (!allowRoles?.length) return true;
  if (!userRole) return false;
  if (userRole === "superadmin") return true;
  return allowRoles.includes(userRole);
}
