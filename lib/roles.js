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

/** Vai trò có thể gán khi thêm/sửa user (không gồm superadmin) */
export const ROLE_OPTIONS = [
  {
    value: "manager",
    label: "Quản lý",
    description: "POS, chốt ca, đối soát, vốn, báo cáo tháng",
  },
  {
    value: "employee",
    label: "Nhân viên",
    description: "Bán hàng POS và chốt ca",
  },
  {
    value: "investor",
    label: "Chủ đầu tư",
    description: "Xem đối soát, vốn góp, tổng kết tháng",
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

/** Chỉ Super Admin quản lý người dùng */
export function canManageUsers(role) {
  return role === "superadmin";
}

/** Bán hàng / chốt ca */
export function canOperateShop(role) {
  return (
    role === "superadmin" || role === "manager" || role === "employee"
  );
}

/** Dashboard tài chính */
export function canViewDashboard(role) {
  return (
    role === "superadmin" || role === "manager" || role === "investor"
  );
}

/** Quyền quản lý quán (form vốn, cấu hình quỹ…) */
export function canManageShop(role) {
  return role === "superadmin" || role === "manager";
}

export function homePathForRole(role) {
  if (role === "investor") return "/dashboard";
  if (role === "employee") return "/manager/pos";
  if (role === "superadmin") return "/admin/users";
  return "/manager/pos";
}

/**
 * Super Admin đi qua mọi route được bảo vệ.
 * Role khác phải nằm trong allowRoles.
 */
export function hasRoleAccess(userRole, allowRoles) {
  if (!allowRoles?.length) return true;
  if (!userRole) return false;
  if (userRole === "superadmin") return true;
  return allowRoles.includes(userRole);
}
