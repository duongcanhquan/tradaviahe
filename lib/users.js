import { initializeApp, deleteApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  defaultPasswordForUsername,
  normalizeUsername,
  usernameToEmail,
  validateUsername,
  writeLoginIndex,
} from "./authIdentity";
import {
  canAssignRole,
  canEditTargetUser,
  canManageEmployees,
  canManageUsers,
  ROLES,
} from "./roles";
import { getSettingsRef } from "./settings";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export async function countSuperAdmins() {
  const q = query(
    collection(db, "users"),
    where("role", "==", ROLES.superadmin)
  );
  const snap = await getDocs(q);
  return snap.size;
}

export async function isUsernameTaken(username, excludeUid = null) {
  const u = normalizeUsername(username);
  const q = query(collection(db, "users"), where("username", "==", u));
  const snap = await getDocs(q);
  return snap.docs.some((d) => d.id !== excludeUid);
}

/**
 * Đảm bảo đúng 1 Super Admin:
 * - User đăng nhập chưa có hồ sơ + chưa có SA → claim Super Admin
 * - User đã là manager và hệ thống chưa có SA → nâng lên Super Admin
 * - Đã có SA khác → giữ nguyên / tạo hồ sơ employee nếu chưa có
 */
export async function ensureUserProfile(firebaseUser) {
  const uid = firebaseUser.uid;
  const email = firebaseUser.email || "";
  const usernameFromEmail = normalizeUsername(email.split("@")[0] || "");
  const defaultName = usernameFromEmail || "Người dùng";
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);

  let saCount = 0;
  try {
    saCount = await countSuperAdmins();
  } catch {
    // Query bị chặn — không chặn đăng nhập
    saCount =
      snap.exists() && snap.data()?.role === ROLES.superadmin ? 1 : 0;
  }

  if (!snap.exists()) {
    if (saCount === 0) {
      const profile = {
        uid,
        email,
        username: usernameFromEmail,
        name: defaultName,
        role: ROLES.superadmin,
        phone: "",
        note: "Super Admin hệ thống",
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(userRef, profile);
      await setDoc(
        getSettingsRef(),
        { superAdminUid: uid, updatedAt: serverTimestamp() },
        { merge: true }
      );
      return {
        uid,
        email,
        username: usernameFromEmail,
        name: defaultName,
        role: ROLES.superadmin,
        phone: "",
        note: "Super Admin hệ thống",
        active: true,
      };
    }

    const profile = {
      uid,
      email,
      username: usernameFromEmail,
      name: defaultName,
      role: ROLES.employee,
      phone: "",
      note: "Chờ Super Admin cấp quyền",
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(userRef, profile);
    return {
      uid,
      email,
      username: usernameFromEmail,
      name: defaultName,
      role: ROLES.employee,
      phone: "",
      note: "Chờ Super Admin cấp quyền",
      active: true,
    };
  }

  const data = { uid, ...snap.data() };

  // Bổ sung username nếu hồ sơ cũ chưa có
  if (!data.username && usernameFromEmail) {
    await updateDoc(userRef, {
      username: usernameFromEmail,
      updatedAt: serverTimestamp(),
    });
    data.username = usernameFromEmail;
  }

  // Đồng bộ login_index để lần sau đăng nhập bằng tên (không cần email)
  if (data.username && data.email) {
    try {
      await writeLoginIndex({
        username: data.username,
        email: data.email,
        uid,
      });
    } catch {
      // ignore — không chặn đăng nhập
    }
  }

  if (data.active === false) {
    return { ...data, blocked: true };
  }

  // Nâng user đăng nhập lên SA nếu chưa có SA nào
  if (saCount === 0 && data.role !== ROLES.superadmin) {
    await updateDoc(userRef, {
      role: ROLES.superadmin,
      note: data.note || "Super Admin hệ thống",
      updatedAt: serverTimestamp(),
    });
    await setDoc(
      getSettingsRef(),
      { superAdminUid: uid, updatedAt: serverTimestamp() },
      { merge: true }
    );
    return { ...data, role: ROLES.superadmin };
  }

  return data;
}

/**
 * Tạo user Auth bằng app phụ để không đăng xuất admin hiện tại,
 * rồi ghi hồ sơ vào collection users (username + password để admin xem).
 */
export async function createManagedUser({
  username,
  password,
  name,
  role,
  phone = "",
  note = "",
  createdBy,
  actorRole,
}) {
  if (!canManageEmployees(actorRole)) {
    throw new Error("Bạn không có quyền tạo người dùng");
  }
  if (role === ROLES.superadmin) {
    throw new Error("Không thể tạo thêm Super Admin. Hệ thống chỉ có 1 Super Admin.");
  }
  if (![ROLES.manager, ROLES.employee, ROLES.investor].includes(role)) {
    throw new Error("Vai trò không hợp lệ");
  }
  if (!canAssignRole(actorRole, role)) {
    throw new Error("Bạn không có quyền gán vai trò này");
  }

  const usernameError = validateUsername(username);
  if (usernameError) throw new Error(usernameError);
  if (!password || password.length < 6) {
    throw new Error("Mật khẩu tối thiểu 6 ký tự");
  }

  const normalized = normalizeUsername(username);
  if (await isUsernameTaken(normalized)) {
    throw new Error("Tên đăng nhập đã tồn tại");
  }

  const email = usernameToEmail(normalized);
  const appName = `Secondary-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      email,
      password
    );
    const uid = credential.user.uid;

    await setDoc(doc(db, "users", uid), {
      uid,
      email,
      username: normalized,
      password,
      name: name.trim(),
      role,
      phone: phone.trim(),
      note: note.trim(),
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: createdBy || null,
    });

    await writeLoginIndex({ username: normalized, email, uid });

    await signOut(secondaryAuth);
    return uid;
  } finally {
    try {
      await deleteApp(secondaryApp);
    } catch {
      // ignore cleanup errors
    }
  }
}

export async function updateManagedUser(
  uid,
  data,
  { currentUserId, users = [], actorRole } = {}
) {
  if (data.role === ROLES.superadmin) {
    throw new Error("Không thể gán thêm quyền Super Admin");
  }

  const target = users.find((u) => (u.uid || u.id) === uid);
  if (!target) throw new Error("Không tìm thấy người dùng");
  if (actorRole && !canEditTargetUser(actorRole, target.role)) {
    throw new Error("Bạn không có quyền sửa người dùng này");
  }
  if (target?.role === ROLES.superadmin) {
    if (data.role && data.role !== ROLES.superadmin) {
      throw new Error("Không thể đổi vai trò của Super Admin");
    }
  }
  if (data.role && actorRole && !canAssignRole(actorRole, data.role)) {
    throw new Error("Bạn không có quyền gán vai trò này");
  }

  const payload = {
    updatedAt: serverTimestamp(),
  };
  if (data.name !== undefined) payload.name = String(data.name).trim();
  if (data.role !== undefined) payload.role = data.role;
  if (data.phone !== undefined) payload.phone = String(data.phone).trim();
  if (data.note !== undefined) payload.note = String(data.note).trim();
  if (data.active !== undefined) payload.active = Boolean(data.active);
  if (data.password !== undefined) payload.password = String(data.password);

  await updateDoc(doc(db, "users", uid), payload);
}

/**
 * Đặt lại mật khẩu 1 user: đăng nhập app phụ bằng MK đang lưu → updatePassword.
 */
export async function resetManagedUserPassword(
  uid,
  newPassword,
  { users = [], actorRole } = {}
) {
  if (!canManageUsers(actorRole)) {
    throw new Error("Chỉ Super Admin hoặc Chủ đầu tư mới được reset mật khẩu");
  }
  if (!newPassword || newPassword.length < 6) {
    throw new Error("Mật khẩu mới tối thiểu 6 ký tự");
  }

  const target = users.find((u) => (u.uid || u.id) === uid);
  if (!target) throw new Error("Không tìm thấy người dùng");
  if (target.role === ROLES.superadmin && actorRole !== ROLES.superadmin) {
    throw new Error("Chỉ Super Admin mới được reset mật khẩu Super Admin");
  }

  const username = normalizeUsername(target.username || target.email?.split("@")[0]);
  const email = target.email || usernameToEmail(username);
  const currentPassword = target.password;

  if (!currentPassword) {
    throw new Error(
      "Chưa có mật khẩu lưu trên hồ sơ — nhờ user đổi MK trong Cài đặt trước, hoặc xóa rồi tạo lại tài khoản"
    );
  }

  const appName = `ResetPwd-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    await signInWithEmailAndPassword(secondaryAuth, email, currentPassword);
    await updatePassword(secondaryAuth.currentUser, newPassword);
    await signOut(secondaryAuth);
    await updateDoc(doc(db, "users", uid), {
      password: newPassword,
      username: username || target.username || "",
      updatedAt: serverTimestamp(),
    });
    return { uid, username, password: newPassword };
  } catch (error) {
    if (
      error?.code === "auth/wrong-password" ||
      error?.code === "auth/invalid-credential"
    ) {
      throw new Error(
        "Mật khẩu trên hồ sơ lệch Auth — nhờ user tự đổi trong Cài đặt, hoặc xóa rồi tạo lại"
      );
    }
    throw error;
  } finally {
    try {
      await deleteApp(secondaryApp);
    } catch {
      // ignore
    }
  }
}

/** Reset mật khẩu tất cả user về mặc định theo tên đăng nhập */
export async function resetAllManagedPasswords({ users = [], actorRole } = {}) {
  if (!canManageUsers(actorRole)) {
    throw new Error("Chỉ Super Admin hoặc Chủ đầu tư mới được reset tất cả mật khẩu");
  }
  const results = { ok: [], failed: [] };

  for (const row of users) {
    const uid = row.uid || row.id;
    const username = normalizeUsername(
      row.username || row.email?.split("@")[0] || ""
    );
    if (!username) {
      results.failed.push({ uid, reason: "Thiếu tên đăng nhập" });
      continue;
    }
    const newPassword = defaultPasswordForUsername(username);
    try {
      await resetManagedUserPassword(uid, newPassword, { users, actorRole });
      results.ok.push({ uid, username, password: newPassword });
    } catch (error) {
      results.failed.push({
        uid,
        username,
        reason: error?.message || "Lỗi",
      });
    }
  }

  return results;
}

/**
 * Xóa hồ sơ Firestore.
 * Tài khoản Auth vẫn tồn tại trừ khi dùng Firebase Admin SDK.
 */
export async function deleteManagedUser(
  uid,
  { users = [], currentUserId, actorRole } = {}
) {
  if (uid === currentUserId) {
    throw new Error("Không thể xóa chính bạn");
  }
  const target = users.find((u) => (u.uid || u.id) === uid);
  if (target?.role === ROLES.superadmin) {
    throw new Error("Không thể xóa Super Admin");
  }
  if (actorRole && target && !canEditTargetUser(actorRole, target.role)) {
    throw new Error("Bạn không có quyền xóa người dùng này");
  }
  await deleteDoc(doc(db, "users", uid));
}

export function subscribeUsers(callback, onError) {
  return onSnapshot(
    collection(db, "users"),
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) =>
          String(a.name || a.username || a.email || "").localeCompare(
            String(b.name || b.username || b.email || ""),
            "vi"
          )
        );
      callback(list);
    },
    onError
  );
}

/** Đồng bộ login_index từ danh sách users (chạy khi đã đăng nhập) */
export async function syncLoginIndexes(users = []) {
  let count = 0;
  for (const row of users) {
    const uid = row.uid || row.id;
    const username = normalizeUsername(
      row.username || String(row.email || "").split("@")[0] || ""
    );
    const email = row.email;
    if (!username || !email) continue;
    await writeLoginIndex({ username, email, uid });
    if (!row.username) {
      await updateDoc(doc(db, "users", uid), {
        username,
        updatedAt: serverTimestamp(),
      });
    }
    count += 1;
  }
  return count;
}
