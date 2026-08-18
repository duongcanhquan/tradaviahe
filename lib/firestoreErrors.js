/**
 * Chuyển lỗi Firestore sang câu tiếng Việt dễ hiểu cho người vận hành.
 */
export function firestoreErrorMessage(error, fallback = "Không tải được dữ liệu") {
  const code = error?.code || "";
  const msg = String(error?.message || "");

  if (code === "failed-precondition" || msg.includes("requires an index")) {
    return "Thiếu Firestore index — chạy npm run firebase:indexes hoặc bấm link trong console trình duyệt.";
  }
  if (code === "permission-denied") {
    return "Không có quyền đọc dữ liệu — kiểm tra đăng nhập và Firestore Rules.";
  }
  if (code === "unavailable" || code === "deadline-exceeded") {
    return "Firestore tạm không phản hồi — thử lại sau vài giây.";
  }
  return fallback;
}
