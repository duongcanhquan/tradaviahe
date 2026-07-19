'use client';

import EmployeeDesk from "@/components/EmployeeDesk";
import ProtectedRoute from "@/components/ProtectedRoute";

/**
 * POS / Thu tiền — mọi vai trò từ nhân viên trở lên dùng cùng bàn thu.
 * Quản lý & Chủ ĐT kế thừa quyền nhân viên.
 */
export default function PosPage() {
  return (
    <ProtectedRoute allowRoles={["manager", "employee", "investor"]}>
      <EmployeeDesk />
    </ProtectedRoute>
  );
}
