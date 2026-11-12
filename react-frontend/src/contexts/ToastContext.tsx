// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Toast Notification Context
 * Provides global toast notifications for API errors and user feedback.
 */

import {
  createContext,
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { lazyWithRetry } from '@/routes/lazyWithRetry';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  show: (toast: Omit<Toast, 'id'>) => void;
  showToast: (title: string, type?: ToastType, message?: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);
// Route the ToastViewport chunk through the shared stale-chunk recovery wrapper
// (not bare React.lazy): a toast can fire on a page that has been open across a
// deploy, and its hashed chunk may have been re-hashed and 404. lazyWithRetry
// triggers the one-time reload-to-fresh-index recovery instead of crashing the
// subtree to the root error boundary. See routes/lazyWithRetry.ts.
const loadToastViewport = () => import('@/components/feedback/ToastViewport');
// Offline, an unsaved chunk must not take the page down with it: the message is
// skipped instead (2026-11-12). Online failures still go through the recovery.
const ToastViewport = lazyWithRetry(() => loadToastViewport().catch((error: unknown) => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { default: () => null };
  }
  throw error;
}));

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Fetch the toast chunk once the page is idle, so the service worker has it
  // before the member might go offline (where a toast is likely: "you're offline").
  useEffect(() => {
    if (typeof window === 'undefined' || navigator.onLine === false) return undefined;
    const preload = () => { void loadToastViewport().catch(() => undefined); };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(preload, { timeout: 5_000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(preload, 2_000);
    return () => window.clearTimeout(timer);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const duration = toast.duration ?? (toast.type === 'error' ? 9000 : 4000);

    setToasts((prev) => [...prev, { ...toast, id }]);

    if (duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
  }, [removeToast]);

  const success = useCallback((title: string, message?: string) => {
    addToast({ type: 'success', title, message });
  }, [addToast]);

  const error = useCallback((title: string, message?: string) => {
    addToast({ type: 'error', title, message });
  }, [addToast]);

  const warning = useCallback((title: string, message?: string) => {
    addToast({ type: 'warning', title, message });
  }, [addToast]);

  const info = useCallback((title: string, message?: string) => {
    addToast({ type: 'info', title, message });
  }, [addToast]);

  const showToast = useCallback((title: string, type: ToastType = 'info', message?: string) => {
    addToast({ type, title, message });
  }, [addToast]);

  const value = useMemo(
    () => ({ toasts, addToast, removeToast, success, error, warning, info, show: addToast, showToast }),
    [toasts, addToast, removeToast, success, error, warning, info, showToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <Suspense fallback={null}>
          <ToastViewport toasts={toasts} onRemove={removeToast} />
        </Suspense>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const context = use(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }

  // Keep the returned object stable so callbacks depending on `toast` do not
  // restart effects whenever the toast list changes.
  const ref = useRef(context);
  ref.current = context;

  return useMemo<ToastContextType>(
    () => ({
      get toasts() { return ref.current.toasts; },
      addToast: context.addToast,
      removeToast: context.removeToast,
      success: context.success,
      error: context.error,
      warning: context.warning,
      info: context.info,
      show: context.show,
      showToast: context.showToast,
    }),
    [
      context.addToast,
      context.removeToast,
      context.success,
      context.error,
      context.warning,
      context.info,
      context.show,
      context.showToast,
    ],
  );
}

export default ToastProvider;
