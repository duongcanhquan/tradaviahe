# Trà Đá App (PWA)

Ứng dụng PWA quản lý bán hàng, tồn kho và đối chiếu dòng tiền cho quán trà đá (4 cổ đông).

## Tech stack
- Next.js 14 (App Router) + JavaScript
- Tailwind CSS (mobile-first)
- Firebase Auth + Firestore
- next-pwa, lucide-react, recharts, date-fns

## Chạy local
```bash
npm install
cp .env.example .env.local   # hoặc copy biến từ Vercel
npm run dev
```

Mở http://localhost:3000

## Firebase setup

### 1. Biến môi trường
Copy `.env.example` → `.env.local` (local) hoặc cấu hình trên **Vercel → Settings → Environment Variables** (production).

### 2. Authorized domains (bắt buộc cho Vercel)
Firebase Console → **Authentication → Settings → Authorized domains** → thêm:
- `tradaviahe.vercel.app`
- (tuỳ chọn) `*.vercel.app` nếu dùng preview deploy

Nếu thiếu bước này, app trên Vercel báo lỗi đăng nhập / không vào được dữ liệu.

### 3. Firestore indexes
Sau khi pull code mới, deploy index một lần:
```bash
npm run firebase:indexes
```
(hoặc bấm link trong console trình duyệt khi Firestore báo thiếu index)

### 4. Auth + hồ sơ user
1. Bật Email/Password trong Authentication.
2. Tạo user trên Firebase Auth.
3. Tạo document `users/{uid}` với fields:
   - `uid`, `email`, `name`, `role` (`manager` | `investor`)
4. (Tuỳ chọn) Seed sản phẩm trong app: Cài đặt → Seed sản phẩm mẫu.
5. Rules Firestore tối thiểu cho dev (siết lại khi production) — xem `firestore.rules`:

Đăng nhập chỉ cần **tên tài khoản + mật khẩu** (không dùng email). App tạo email nội bộ `tên@tradaviahe.app` phía sau.

## Modules
- `/login` — Đăng nhập
- `/manager/pos` — Bán hàng + VietQR
- `/manager/inventory` — Kiểm kê & chốt ca
- `/dashboard` — Thu/Chi/Lợi nhuận + lịch sử chốt ca + biểu đồ
- `/settings` — Hồ sơ, seed data, ghi chi, đăng xuất

## PWA
Build production rồi cài Add to Home Screen:
```bash
npm run build && npm start
```
Manifest: `display: standalone`, `theme_color: #1e40af`.

## Webhook n8n (tuỳ chọn)
Thêm vào `.env.local`:
```
NEXT_PUBLIC_N8N_WEBHOOK_URL=https://your-n8n/webhook/...
```
