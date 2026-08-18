/**
 * Chuyển lỗi Firestore sang câu tiếng Việt dễ hiểu cho người vận hành.
 */
export function firestoreErrorCode(error) {
  return String(error?.code || "")
    .replace(/^firestore\//, "")
    .replace(/^auth\//, "");
}

export function firestoreErrorMessage(error, fallback = "Không tải được dữ liệu") {
  const code = firestoreErrorCode(error);
  const msg = String(error?.message || "");

  if (code === "failed-precondition" || msg.includes("requires an index")) {
    return "Thiếu Firestore index — chạy npm run firebase:firestore trong thư mục tradaviahe.";
  }
  if (code === "permission-denied") {
    return "Firestore từ chối quyền đọc. Deploy rules: npm run firebase:firestore (trong thư mục tradaviahe).";
  }
  if (code === "unavailable" || code === "deadline-exceeded") {
    return "Firestore tạm không phản hồi — thử lại sau vài giây.";
  }
  if (code === "unauthenticated" || code === "invalid-argument") {
    return "Phiên đăng nhập chưa gắn với Firestore — đăng xuất rồi đăng nhập lại.";
  }
  if (code) {
    return `${fallback} (${code})`;
  }
  return fallback;
}
