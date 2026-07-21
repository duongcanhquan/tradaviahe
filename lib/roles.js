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
 * Bậc quyền — cấp cao kế thừa toàn bộ quyền cấp thấp:
 * Super Admin ⊃ Chủ ĐT (admin) ⊃ Quản lý ⊃ Nhân viên
 */
export const ROLE_LEVEL = {
  employee: 1,
  manager: 2,
  investor: 3,
  superadmin: 4,
};

/** role có ít nhất quyền của minimum không */
export function roleAtLeast(role, minimum) {
  return (ROLE_LEVEL[role] || 0) >= (ROLE_LEVEL[minimum] || Number.POSITIVE_INFINITY);
}

/**
 * Vai trò có thể gán khi thêm/sửa user (không gồm superadmin).
 */
export const ROLE_OPTIONS = [
  {
    value: "manager",
    label: "Quản lý",
    description:
      "Quản lý quán + món/giá + POS. Chỉ xem tổng thu hàng hóa — không cổ tức / chia lãi / vốn góp",
  },
  {
    value: "employee",
    label: "Nhân viên",
    description: "Chỉ nhập tiền thu (POS) và xem QR — cấp thấp nhất",
  },
  {
    value: "investor",
    label: "Chủ đầu tư",
    description:
      "Cổ đông: xem sổ vốn/% cổ phần/cổ tức, tiền nhận (TM/CK), Admin MK (trừ tài khoản quản trị). Ghi/sửa vốn & chi tiêu vốn: chỉ tài khoản quản trị",
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

/**
 * Nhãn hiển thị thường ngày — không lộ "Super Admin".
 * Đăng nhập đúng tài khoản là đủ biết quyền.
 */
export function displayRoleLabel(role) {
  if (role === "superadmin") return ROLE_LABELS.investor;
  return roleLabel(role);
}

/**
 * Sửa vốn ban đầu / thêm vốn / ghi chi tiêu vốn — chỉ Super Admin.
 * Chủ ĐT vẫn xem sổ vốn + % cổ phần.
 */
export function canManageShareholderCapital(role) {
  return role === "superadmin";
}

/** Admin người dùng: xem/reset mật khẩu — Super Admin + Chủ đầu tư */
export function canManageUsers(role) {
  return role === "superadmin" || role === "investor";
}

/**
 * Quản lý nhân viên (thêm/sửa/xóa nhân viên).
 * Quản lý + Chủ ĐT + Super Admin.
 */
export function canManageEmployees(role) {
  return roleAtLeast(role, "manager");
}

/** Chủ đầu tư + Super Admin: quản lý toàn bộ hệ thống */
export function canManageSystem(role) {
  return roleAtLeast(role, "investor");
}

/** Bán hàng / nhập thu / xem QR (gồm nhân viên; quản lý & chủ ĐT kế thừa) */
export function canOperateShop(role) {
  return roleAtLeast(role, "employee");
}

/** Chỉ nhập tiền thu (POS) — nhân viên và cấp trên */
export function canEnterIncome(role) {
  return canOperateShop(role);
}

/**
 * Xóa / sửa món·khoản thu đã ghi (nhầm) — Quản lý + Chủ ĐT + Super Admin.
 * Nhân viên không được.
 */
export function canDeleteSales(role) {
  return roleAtLeast(role, "manager");
}

/** Alias: sửa giao dịch bán hàng cùng quyền với xóa */
export function canEditSales(role) {
  return canDeleteSales(role);
}

/** Xem/sửa tồn kho & đối soát hàng — nhân viên không được */
export function canCloseShift(role) {
  return roleAtLeast(role, "manager");
}

/** Alias rõ nghĩa hơn cho tồn kho */
export function canManageInventory(role) {
  return canCloseShift(role);
}

/** Dashboard tài chính */
export function canViewDashboard(role) {
  return roleAtLeast(role, "manager");
}

/**
 * Vận hành tài chính quán: dòng tiền thu/chi, nhập hàng hóa/thiết bị,
 * seed, cấu hình quỹ, setup món & giá.
 */
export function canManageShop(role) {
  return roleAtLeast(role, "manager");
}

/**
 * Setup món bán / nguyên liệu / giá nhập·giá bán / công thức cost / nhóm SP.
 * Quản lý + Chủ ĐT (Admin) + Super Admin.
 */
export function canManageProducts(role) {
  return roleAtLeast(role, "manager");
}

/**
 * Xóa nhóm sản phẩm — chỉ cấp Admin (Cổ đông / Super Admin).
 * Quản lý được thêm/sửa nhóm nhưng không xóa.
 */
export function canDeleteProductGroups(role) {
  return roleAtLeast(role, "investor");
}

/**
 * Xem tiền đầu tư / cổ phần / chia cổ tức theo vốn góp cash.
 * Chủ đầu tư (cổ đông) + Super Admin — Quản lý không xem.
 */
export function canViewInvestmentCapital(role) {
  return roleAtLeast(role, "investor");
}

/**
 * Xem cổ tức / chia lãi / lợi nhuận phân bổ cổ đông.
 * Quản lý không có quyền này.
 */
export function canViewDividends(role) {
  return roleAtLeast(role, "investor");
}

/**
 * Cổ đông cập nhật tiền đã nhận (tiền mặt / chuyển khoản tài khoản).
 */
export function canManageShareholderReceipts(role) {
  return roleAtLeast(role, "investor");
}

/** Nhập & xem hàng hóa / thiết bị */
export function canManageAssets(role) {
  return roleAtLeast(role, "manager");
}

/** Vai trò actor được phép gán cho user mới/sửa */
export function assignableRolesFor(actorRole) {
  if (roleAtLeast(actorRole, "investor")) {
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
  if (roleAtLeast(actorRole, "investor")) {
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
  if (roleAtLeast(actorRole, "investor")) {
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
  /** Tài khoản quản trị vào đối soát — Admin nằm trong Cài đặt */
  if (role === "superadmin") return "/dashboard";
  if (role === "manager") return "/manager/pos";
  return "/manager/pos";
}

/**
 * Kiểm tra vào route: role cao kế thừa role thấp trong allowRoles.
 * Ví dụ allowRoles=["employee"] → quản lý / chủ ĐT / SA cũng vào được.
 * Super Admin luôn đi qua mọi route được bảo vệ.
 */
export function hasRoleAccess(userRole, allowRoles) {
  if (!allowRoles?.length) return true;
  if (!userRole) return false;
  if (userRole === "superadmin") return true;
  return allowRoles.some((allowed) => {
    if (userRole === allowed) return true;
    if (allowed === "employee") return roleAtLeast(userRole, "employee");
    if (allowed === "manager") return roleAtLeast(userRole, "manager");
    if (allowed === "investor") return roleAtLeast(userRole, "investor");
    if (allowed === "superadmin") return userRole === "superadmin";
    return false;
  });
}
