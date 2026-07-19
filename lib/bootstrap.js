import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  updatePassword,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
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
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
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
    // ignore
  }

  try {
    await setDoc(
      getSettingsRef(),
      { superAdminUid: uid, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch {
    // ignore
  }
}

/**
 * Đăng nhập Super Admin bằng tên canhquan (không hiện email).
 * - Đã có Auth + đúng MK mặc định → đăng nhập, ghi hồ sơ, GIỮ phiên
 * - Chưa có Auth → tạo luôn rồi giữ phiên
 * - MK đã đổi → báo dùng form thường
 * KHÔNG đăng xuất giữa chừng (tránh làm hỏng login).
 */
export async function loginAsDefaultSuperAdmin() {
  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      SUPERADMIN_EMAIL,
      SUPERADMIN_DEFAULT_PASSWORD
    );
    await upsertSuperAdminProfile(credential.user.uid);
    return { user: credential.user, created: false };
  } catch (error) {
    const code = error?.code || "";
    const canTryCreate =
      code === "auth/user-not-found" ||
      code === "auth/invalid-credential" ||
      code === "auth/invalid-login-credentials" ||
      code === "auth/wrong-password";

    if (!canTryCreate) throw error;

    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        SUPERADMIN_EMAIL,
        SUPERADMIN_DEFAULT_PASSWORD
      );
      await upsertSuperAdminProfile(credential.user.uid);
      return { user: credential.user, created: true };
    } catch (createError) {
      if (createError?.code === "auth/email-already-in-use") {
        const err = new Error(
          "Mật khẩu Super Admin đã đổi. Gõ tên canhquan + mật khẩu hiện tại rồi Đăng nhập."
        );
        err.code = "auth/wrong-password";
        throw err;
      }
      throw createError;
    }
  }
}

/** Giữ API cũ — gọi loginAsDefaultSuperAdmin */
export async function ensureDefaultSuperAdmin() {
  try {
    const result = await loginAsDefaultSuperAdmin();
    return {
      created: result.created,
      reason: result.created ? "created" : "already_exists",
      uid: result.user.uid,
      username: SUPERADMIN_USERNAME,
      signedIn: true,
    };
  } catch (error) {
    if (error?.code === "auth/wrong-password") {
      return {
        created: false,
        reason: "auth_exists_login",
        message: error.message,
        signedIn: false,
      };
    }
    throw error;
  }
}

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
