// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import X from 'lucide-react/icons/x';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import AlertCircle from 'lucide-react/icons/circle-alert';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Info from 'lucide-react/icons/info';
import { motion, AnimatePresence } from '@/lib/motion';
import type { Toast, ToastType } from '@/contexts/ToastContext';

interface ToastViewportProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export default function ToastViewport({ toasts, onRemove }: ToastViewportProps) {
  const { t } = useTranslation('common');
  const urgentToasts = toasts.filter((toast) => toast.type === 'error' || toast.type === 'warning');
  const politeToasts = toasts.filter((toast) => toast.type === 'success' || toast.type === 'info');

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(5rem+var(--safe-area-bottom)+var(--miniplayer-offset,0rem))] z-[9999] flex w-auto max-w-sm flex-col gap-2 sm:start-auto sm:end-4 sm:w-[calc(100vw-2rem)] md:bottom-[calc(1rem+var(--safe-area-bottom)+var(--miniplayer-offset,0rem))]">
      <div
        role="alert"
        aria-live="assertive"
        aria-label={t('toast.aria_urgent_notifications')}
        aria-atomic="false"
        className="flex flex-col gap-2"
      >
        <AnimatePresence mode="popLayout">
          {urgentToasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
          ))}
        </AnimatePresence>
      </div>

      <div
        role="status"
        aria-label={t('toast.aria_notifications')}
        aria-live="polite"
        aria-atomic="false"
        className="flex flex-col gap-2"
      >
        <AnimatePresence mode="popLayout">
          {politeToasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

// Light card in the page's own surface colour with a tinted icon tile per
// kind (warmth plan Phase 4 A5). Until 11 Nov 2026 every toast was a dark
// slate box, in light mode too, with a faint white close button.
const config: Record<ToastType, {
  icon: typeof CheckCircle;
  tile: string;
}> = {
  success: {
    icon: CheckCircle,
    tile: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  error: {
    icon: AlertCircle,
    tile: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  },
  warning: {
    icon: AlertTriangle,
    tile: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  },
  info: {
    icon: Info,
    tile: 'bg-accent-soft text-accent-soft-foreground',
  },
};

/** A tick that draws itself in (still under reduced motion — see .toast-tick in index.css). */
function DrawnTick() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path className="toast-tick" d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function ToastItem({ toast, onRemove, ref }: ToastItemProps & { ref?: Ref<HTMLDivElement> }) {
  const { t } = useTranslation('common');
  const { icon: Icon, tile } = config[toast.type];

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 100, scale: 0.95 }}
      // Structural hook for the E2E suite — this is ONE REAL TOAST.
      //
      // 🔴 Do not remove, and do not let a test match a toast by `[role="alert"]`
      // instead. The two `role` containers above are mounted unconditionally and
      // stay in the DOM with zero toasts, and `role="alert"` is used all over the
      // app for ordinary error banners (a safeguarding notice on the message
      // thread is one). A test asserting "a toast appeared" via `[role="alert"]`
      // therefore passes when the action FAILED and merely rendered an error —
      // a false pass, which is worse than a dead selector.
      data-toast={toast.type}
      className="pointer-events-auto rounded-2xl border border-theme-default bg-[var(--surface-solid)] p-3 shadow-[var(--shadow-card-hover)]"
    >
      <div className="flex items-start gap-3">
        <span className={`flex size-9 flex-shrink-0 items-center justify-center rounded-full ${tile}`} aria-hidden="true">
          {toast.type === 'success' ? <DrawnTick /> : <Icon className="size-5" />}
        </span>
        <div className="flex-1 min-w-0 pt-1.5">
          <p className="font-semibold text-theme-primary text-sm">{toast.title}</p>
          {toast.message && (
            <p className="text-theme-secondary text-sm mt-0.5">{toast.message}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onRemove(toast.id)}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full p-0 text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={t('toast.aria_dismiss_notification')}
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </motion.div>
  );
}
