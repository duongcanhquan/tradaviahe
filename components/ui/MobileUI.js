'use client';

import Link from "next/link";
import { cn } from "@/lib/utils";

/** Chip lọc / segment — tối thiểu ~44px cao */
export function FilterChip({
  active = false,
  children,
  className,
  type = "button",
  ...props
}) {
  return (
    <button
      type={type}
      className={cn(
        "touch-btn h-11 shrink-0 rounded-2xl px-3.5 text-sm font-bold transition duration-200",
        active
          ? "bg-brand-700 text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.16)]"
          : "bg-white text-slate-700 ring-1 ring-slate-200",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function ChipRow({ children, className }) {
  return (
    <div
      className={cn(
        "-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SectionHeader({ title, hint, action = null, className }) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="section-title">{title}</h2>
        {hint ? <p className="hint-line mt-0.5">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon: Icon = null,
  title,
  description,
  action = null,
  className,
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-[1.25rem] bg-white px-5 py-10 text-center ring-1 ring-slate-200",
        className
      )}
    >
      {Icon ? (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <Icon className="h-6 w-6" aria-hidden />
        </div>
      ) : null}
      <p className="text-base font-bold text-slate-900">{title}</p>
      {description ? (
        <p className="mt-1 max-w-xs text-sm leading-relaxed text-slate-500">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5 w-full max-w-xs">{action}</div> : null}
    </div>
  );
}

/**
 * Bottom sheet chuẩn app.
 * subtitle: string (hiển thị dạng money nếu lookMoney) hoặc React node trong div.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  subtitle = null,
  lookMoney = false,
  children,
  footer = null,
  className,
  labelledBy = "bottom-sheet-title",
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end bg-slate-950/50 sm:items-center sm:justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={onClose}
    >
      <section
        className={cn(
          "flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.75rem] bg-white shadow-soft-lg sm:rounded-[1.75rem]",
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 justify-center pt-3 sm:hidden">
          <span className="h-1 w-10 rounded-full bg-slate-200" aria-hidden />
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-2">
          <div className="min-w-0">
            <h2
              id={labelledBy}
              className="truncate text-lg font-bold tracking-tight text-slate-900"
            >
              {title}
            </h2>
            {subtitle != null && subtitle !== "" ? (
              <div
                className={cn(
                  "mt-0.5 truncate",
                  lookMoney
                    ? "money text-xl font-bold text-brand-800"
                    : "text-sm text-slate-500"
                )}
              >
                {subtitle}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={onClose}
            className="touch-btn h-11 w-11 shrink-0 rounded-2xl bg-slate-100 p-0 text-slate-700"
          >
            <span className="text-lg leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-slate-100 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            {footer}
          </div>
        ) : (
          <div className="pb-[max(0.5rem,env(safe-area-inset-bottom))]" />
        )}
      </section>
    </div>
  );
}

export function FieldLabel({ children, optional = false }) {
  return (
    <span className="mb-1.5 block text-sm font-bold text-slate-700">
      {children}
      {optional ? (
        <span className="ml-1 font-normal text-slate-400">(tuỳ chọn)</span>
      ) : null}
    </span>
  );
}

export function ListRow({
  title,
  subtitle = null,
  meta = null,
  trailing = null,
  onClick = null,
  className,
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "card-panel flex w-full items-start gap-3 text-left transition duration-200",
        onClick && "active:scale-[0.99]",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold leading-snug text-slate-900">
          {title}
        </p>
        {subtitle ? (
          <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
        ) : null}
        {meta ? <div className="mt-2">{meta}</div> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </Comp>
  );
}

export function StickyCta({ children, className }) {
  return (
    <div className={cn("sticky-action-bar", className)}>{children}</div>
  );
}

/** Hàng link cài đặt — một kiểu trắng, không cầu vồng màu */
export function SettingsRow({
  href,
  icon: Icon,
  title,
  description,
  onClick,
}) {
  const className =
    "card-panel flex w-full items-center gap-3 text-left transition duration-200 active:scale-[0.99]";
  const body = (
    <>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
        {Icon ? <Icon className="h-5 w-5" aria-hidden /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold text-slate-900">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-sm text-slate-500">
            {description}
          </span>
        ) : null}
      </span>
      <span className="text-slate-300" aria-hidden>
        ›
      </span>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}
