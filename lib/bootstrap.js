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
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import {
  SUPERADMIN_DEFAULT_PASSWORD,
  SUPERADMIN_EMAIL,
  SUPERADMIN_NAME,
  SUPERADMIN_USERNAME,
} from "./authIdentity";
import { auth, db } from "./firebase";
import { ROLES } from "./roles";
import { getSettingsRef } from "./settings";
import { countSuperAdmins } from "./users";

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
        try {
          const credential = await signInWithEmailAndPassword(
            secondaryAuth,
            SUPERADMIN_EMAIL,
            SUPERADMIN_DEFAULT_PASSWORD
          );
          uid = credential.user.uid;
          await signOut(secondaryAuth);
        } catch {
          return { created: false, reason: "auth_exists_login" };
        }
      } else {
        throw error;
      }
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
      password: SUPERADMIN_DEFAULT_PASSWORD,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(
      getSettingsRef(),
      { superAdminUid: uid, updatedAt: serverTimestamp() },
      { merge: true }
    );

    return { created: true, uid, username: SUPERADMIN_USERNAME };
  } finally {
    try {
      await deleteApp(secondaryApp);
    } catch {
      // ignore
    }
  }
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
