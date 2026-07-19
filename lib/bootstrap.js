import { initializeApp, deleteApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  reauthenticateWithCredential,
  signOut,
  updatePassword,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { ROLES } from "./roles";
import { getSettingsRef } from "./settings";
import { countSuperAdmins } from "./users";

/** Tài khoản Super Admin mặc định */
export const SUPERADMIN_USERNAME = "canhquan";
export const SUPERADMIN_EMAIL = "canhquan@tradaviahe.app";
export const SUPERADMIN_DEFAULT_PASSWORD = "canhquan";
export const SUPERADMIN_NAME = "Canh Quan";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** Cho phép đăng nhập bằng "canhquan" hoặc full email */
export function resolveLoginIdentifier(input) {
  const raw = String(input || "").trim();
  if (!raw) return raw;
  if (raw.includes("@")) return raw.toLowerCase();
  if (raw.toLowerCase() === SUPERADMIN_USERNAME) return SUPERADMIN_EMAIL;
  return `${raw.toLowerCase()}@tradaviahe.app`;
}

/**
 * Tạo Super Admin canhquan nếu hệ thống chưa có SA.
 * An toàn gọi nhiều lần (idempotent).
 */
export async function ensureDefaultSuperAdmin() {
  const saCount = await countSuperAdmins();
  if (saCount > 0) {
    return { created: false, reason: "already_exists" };
  }

  const appName = `BootstrapSA-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    let uid;
    try {
      const credential = await createUserWithEmailAndPassword(
        secondaryAuth,
        SUPERADMIN_EMAIL,
        SUPERADMIN_DEFAULT_PASSWORD
      );
      uid = credential.user.uid;
      await signOut(secondaryAuth);
    } catch (error) {
      if (error?.code === "auth/email-already-in-use") {
        // Auth đã có — cần đăng nhập để lấy uid; trả về để user đăng nhập
        return { created: false, reason: "auth_exists_login" };
      }
      throw error;
    }

    await setDoc(doc(db, "users", uid), {
      uid,
      email: SUPERADMIN_EMAIL,
      name: SUPERADMIN_NAME,
      role: ROLES.superadmin,
      phone: "",
      note: "Super Admin mặc định",
      active: true,
      username: SUPERADMIN_USERNAME,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(
      getSettingsRef(),
      { superAdminUid: uid, updatedAt: serverTimestamp() },
      { merge: true }
    );

    return { created: true, uid, email: SUPERADMIN_EMAIL };
  } finally {
    try {
      await deleteApp(secondaryApp);
    } catch {
      // ignore
    }
  }
}

/** Đổi mật khẩu khi đang đăng nhập (cần mật khẩu hiện tại) */
export async function changeCurrentUserPassword(
  currentPassword,
  newPassword
) {
  const user = auth.currentUser;
  if (!user?.email) {
    throw new Error("Chưa đăng nhập");
  }
  if (!newPassword || newPassword.length < 6) {
    throw new Error("Mật khẩu mới tối thiểu 6 ký tự");
  }

  const credential = EmailAuthProvider.credential(
    user.email,
    currentPassword
  );
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}
