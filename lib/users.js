import { initializeApp, deleteApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
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
import { ROLES } from "./roles";
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

/**
 * Đảm bảo đúng 1 Super Admin:
 * - User đăng nhập chưa có hồ sơ + chưa có SA → claim Super Admin
 * - User đã là manager và hệ thống chưa có SA → nâng lên Super Admin
 * - Đã có SA khác → giữ nguyên / tạo hồ sơ employee nếu chưa có
 */
export async function ensureUserProfile(firebaseUser) {
  const uid = firebaseUser.uid;
  const email = firebaseUser.email || "";
  const defaultName = email.split("@")[0] || "Người dùng";
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  const saCount = await countSuperAdmins();

  if (!snap.exists()) {
    if (saCount === 0) {
      const profile = {
        uid,
        email,
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
      return { uid, email, name: defaultName, role: ROLES.superadmin, phone: "", note: "Super Admin hệ thống", active: true };
    }

    const profile = {
      uid,
      email,
      name: defaultName,
      role: ROLES.employee,
      phone: "",
      note: "Chờ Super Admin cấp quyền",
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(userRef, profile);
    return { uid, email, name: defaultName, role: ROLES.employee, phone: "", note: "Chờ Super Admin cấp quyền", active: true };
  }

  const data = { uid, ...snap.data() };

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
 * rồi ghi hồ sơ vào collection users.
 */
export async function createManagedUser({
  email,
  password,
  name,
  role,
  phone = "",
  note = "",
  createdBy,
}) {
  if (role === ROLES.superadmin) {
    throw new Error("Không thể tạo thêm Super Admin. Hệ thống chỉ có 1 Super Admin.");
  }
  if (![ROLES.manager, ROLES.employee, ROLES.investor].includes(role)) {
    throw new Error("Vai trò không hợp lệ");
  }

  const appName = `Secondary-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      email.trim(),
      password
    );
    const uid = credential.user.uid;

    await setDoc(doc(db, "users", uid), {
      uid,
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role,
      phone: phone.trim(),
      note: note.trim(),
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: createdBy || null,
    });

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

export async function updateManagedUser(uid, data, { currentUserId, users = [] } = {}) {
  if (data.role === ROLES.superadmin) {
    throw new Error("Không thể gán thêm quyền Super Admin");
  }

  const target = users.find((u) => (u.uid || u.id) === uid);
  if (target?.role === ROLES.superadmin) {
    // Cho phép sửa tên/SĐT nhưng không hạ cấp SA
    if (data.role && data.role !== ROLES.superadmin) {
      throw new Error("Không thể đổi vai trò của Super Admin");
    }
  }

  const payload = {
    updatedAt: serverTimestamp(),
  };
  if (data.name !== undefined) payload.name = String(data.name).trim();
  if (data.role !== undefined) payload.role = data.role;
  if (data.phone !== undefined) payload.phone = String(data.phone).trim();
  if (data.note !== undefined) payload.note = String(data.note).trim();
  if (data.active !== undefined) payload.active = Boolean(data.active);

  await updateDoc(doc(db, "users", uid), payload);
}

/**
 * Xóa hồ sơ Firestore.
 * Tài khoản Auth vẫn tồn tại trừ khi dùng Firebase Admin SDK.
 */
export async function deleteManagedUser(uid, { users = [], currentUserId } = {}) {
  if (uid === currentUserId) {
    throw new Error("Không thể xóa chính bạn");
  }
  const target = users.find((u) => (u.uid || u.id) === uid);
  if (target?.role === ROLES.superadmin) {
    throw new Error("Không thể xóa Super Admin");
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
          String(a.name || a.email || "").localeCompare(
            String(b.name || b.email || ""),
            "vi"
          )
        );
      callback(list);
    },
    onError
  );
}
