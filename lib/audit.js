/**
 * Metadata người thao tác — ghi vào giao dịch / báo cáo để truy vết.
 */
export function actorFields(user, profile) {
  const username =
    profile?.username ||
    user?.email?.split("@")[0] ||
    "";
  const name =
    profile?.name ||
    username ||
    user?.email ||
    "Không rõ";

  return {
    createdBy: user?.uid || null,
    createdByName: name,
    createdByUsername: username,
    createdByRole: profile?.role || null,
  };
}

/** Hiển thị ngắn gọn trên UI báo cáo */
export function formatActorLabel(row) {
  if (!row) return "—";
  const name = row.createdByName || row.checkedByName || "";
  const username = row.createdByUsername || row.checkedByUsername || "";
  if (name && username && name.toLowerCase() !== username.toLowerCase()) {
    return `${name} (@${username})`;
  }
  if (name) return name;
  if (username) return `@${username}`;
  return "—";
}
