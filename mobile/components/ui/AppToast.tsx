// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback } from 'react';
import { useToast } from 'heroui-native';

import * as Haptics from '@/lib/haptics';

type AppToastVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger';
type AppToastPlacement = 'top' | 'bottom';
type ToastHideTarget = string | string[] | 'all';

interface AppToastOptions {
  title: string;
  description?: string;
  variant?: AppToastVariant;
  placement?: AppToastPlacement;
  duration?: number | 'persistent';
  actionLabel?: string;
  onActionPress?: () => void;
}

function hapticForVariant(variant: AppToastVariant) {
  if (variant === 'success') return Haptics.NotificationFeedbackType.Success;
  if (variant === 'warning') return Haptics.NotificationFeedbackType.Warning;
  if (variant === 'danger') return Haptics.NotificationFeedbackType.Error;
  return null;
}

export function useAppToast() {
  const { toast, isToastVisible } = useToast();

  const show = useCallback((options: AppToastOptions) => {
    const variant = options.variant ?? 'default';
    const feedback = hapticForVariant(variant);
    if (feedback) {
      void Haptics.notificationAsync(feedback);
    }

    return toast.show({
      actionLabel: options.actionLabel,
      description: options.description,
      duration: options.duration,
      label: options.title,
      placement: options.placement ?? 'bottom',
      variant,
      onActionPress: options.actionLabel
        ? ({ hide }) => {
            options.onActionPress?.();
            hide();
          }
        : undefined,
    });
  }, [toast]);

  const hide = useCallback((target?: ToastHideTarget) => {
    toast.hide(target);
  }, [toast]);

  return {
    hide,
    isToastVisible,
    show,
  };
}

/**
 * A toast that no-ops when there is no ToastProvider above it.
 *
 * 🔴 For code that lives in a PROVIDER rather than a screen. `AuthProvider` needs to say
 * "you have been signed out", but making it call `useAppToast()` directly meant every test
 * that renders `AuthProvider` standalone died with "useToast must be used within a
 * ToastProvider" — eight of them immediately. The real app is fine (HeroUINativeProvider
 * wraps everything), so the failure was purely a coupling one: infrastructure had been made
 * to depend on presentation.
 *
 * This is the same lesson as `useOptionalPrimaryColor` in TenantContext — a component that
 * only wants to *look* right must not be able to take a screen down. A missing toast is an
 * acceptable degradation; a crash is not.
 *
 * Screens should keep using `useAppToast()`, which fails loudly if the provider is missing.
 */
export function useOptionalAppToast(): Pick<ReturnType<typeof useAppToast>, 'show'> {
  let show: ReturnType<typeof useAppToast>['show'] | null = null;

  try {
    // Calling the hook inside try/catch is safe here: the underlying useContext has already
    // run by the time the guard throws, so hook order stays identical on every render.
    ({ show } = useAppToast());
  } catch {
    show = null;
  }

  const noop = useCallback(() => '', []);
  return { show: show ?? (noop as ReturnType<typeof useAppToast>['show']) };
}
