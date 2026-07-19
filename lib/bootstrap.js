import { initializeApp, deleteApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import {
  SUPERADMIN_DEFAULT_PASSWORD,
  SUPERADMIN_EMAIL,
  SUPERADMIN_NAME,
  SUPERADMIN_USERNAME,
  writeLoginIndex,
} from "./authIdentity";
import { auth, db } from "./firebase";
import { ROLES } from "./roles";
import { getSettingsRef } from "./settings";

export {
  SUPERADMIN_DEFAULT_PASSWORD,
  SUPERADMIN_EMAIL,
  SUPERADMIN_NAME,
  SUPERADMIN_USERNAME,
  defaultPasswordForUsername,
  normalizeUsername,
  resolveLoginIdentifier,
  usernameToEmail,
  validateUsername,
} from "./authIdentity";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

async function upsertSuperAdminProfile(uid) {
  await setDoc(
    doc(db, "users", uid),
    {
      uid,
      email: SUPERADMIN_EMAIL,
      name: SUPERADMIN_NAME,
      role: ROLES.superadmin,
      phone: "",
      note: "Super Admin mặc định",
      active: true,
      username: SUPERADMIN_USERNAME,
      password: SUPERADMIN_DEFAULT_PASSWORD,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  try {
    await writeLoginIndex({
      username: SUPERADMIN_USERNAME,
      email: SUPERADMIN_EMAIL,
      uid,
    });
  } catch {
    // login_index có thể bị rules chặn — không sao, vẫn login bằng tên
  }

  await setDoc(
    getSettingsRef(),
    { superAdminUid: uid, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/**
 * Tạo / sửa Super Admin canhquan.
 * Không phụ thuộc đọc users khi chưa login (tránh bị rules chặn).
 * Quy trình: tạo Auth (nếu chưa có) → đăng nhập tạm → ghi hồ sơ → đăng xuất.
 */
export async function ensureDefaultSuperAdmin() {
  const appName = `BootstrapSA-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    // 1) Đảm bảo có tài khoản Auth canhquan@tradaviahe.app
    try {
      await createUserWithEmailAndPassword(
        secondaryAuth,
        SUPERADMIN_EMAIL,
        SUPERADMIN_DEFAULT_PASSWORD
      );
      await signOut(secondaryAuth);
    } catch (error) {
      if (error?.code !== "auth/email-already-in-use") {
        throw error;
      }
      await signOut(secondaryAuth).catch(() => {});
    }

    // 2) Đăng nhập trên auth CHÍNH để ghi được Firestore (rules cần auth)
    try {
      await signInWithEmailAndPassword(
        auth,
        SUPERADMIN_EMAIL,
        SUPERADMIN_DEFAULT_PASSWORD
      );
    } catch (error) {
      // Auth đã có nhưng mật khẩu không còn là mặc định
      if (
        error?.code === "auth/wrong-password" ||
        error?.code === "auth/invalid-credential" ||
        error?.code === "auth/invalid-login-credentials"
      ) {
        return {
          created: false,
          reason: "auth_exists_login",
          message:
            "Tài khoản canhquan đã có. Đăng nhập bằng tên canhquan và mật khẩu hiện tại.",
        };
      }
      throw error;
    }

    const uid = auth.currentUser?.uid;
    if (!uid) {
      throw new Error("Không lấy được tài khoản Super Admin");
    }

    const existing = await getDoc(doc(db, "users", uid));
    const alreadyProfile =
      existing.exists() && existing.data()?.role === ROLES.superadmin;

    await upsertSuperAdminProfile(uid);

    // 3) Đăng xuất — user bấm Đăng nhập lại cho rõ ràng
    await signOut(auth);

    return {
      created: !alreadyProfile,
      reason: alreadyProfile ? "already_exists" : "created",
      uid,
      username: SUPERADMIN_USERNAME,
    };
  } finally {
    try {
      await deleteApp(secondaryApp);
    } catch {
      // ignore
    }
  }
}

/**
 * Đăng nhập Super Admin một chạm (tên canhquan, không hiện email).
 * Tự khởi tạo hồ sơ nếu thiếu.
 */
export async function loginAsDefaultSuperAdmin() {
  // Tạo Auth nếu chưa có
  const appName = `LoginSA-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    try {
      await createUserWithEmailAndPassword(
        secondaryAuth,
        SUPERADMIN_EMAIL,
        SUPERADMIN_DEFAULT_PASSWORD
      );
      await signOut(secondaryAuth);
    } catch (error) {
      if (error?.code !== "auth/email-already-in-use") throw error;
      await signOut(secondaryAuth).catch(() => {});
    }
  } finally {
    try {
      await deleteApp(secondaryApp);
    } catch {
      // ignore
    }
  }

  const credential = await signInWithEmailAndPassword(
    auth,
    SUPERADMIN_EMAIL,
    SUPERADMIN_DEFAULT_PASSWORD
  );

  await upsertSuperAdminProfile(credential.user.uid);
  return credential.user;
}

/** Đổi mật khẩu khi đang đăng nhập (cần mật khẩu hiện tại) + đồng bộ Firestore */
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
  await updateDoc(doc(db, "users", user.uid), {
    password: newPassword,
    updatedAt: serverTimestamp(),
  });
}
