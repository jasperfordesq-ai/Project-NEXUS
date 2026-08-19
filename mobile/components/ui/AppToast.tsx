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
 * 🔴 There is deliberately no `useOptionalAppToast()` here. One existed briefly and was
 * removed, because a toast hook cannot be made optional safely.
 *
 * heroui-native's `useToast` THROWS from inside when no ToastProvider is above it, so
 * wrapping it in try/catch means the hooks after the throw never run — the hook COUNT
 * differs between a tree with a provider and one without. `react-hooks/rules-of-hooks`
 * failed the lint gate on exactly that, correctly; it only appeared to work because
 * provider presence never changes for a given component instance. Its context is not
 * exported, so there is no non-throwing way to read it either.
 *
 * Code that lives in a PROVIDER and needs to say something to the member should publish
 * to `lib/notices/sessionNoticeStore.ts` instead, which needs no provider and no hooks.
 * Screens use `useAppToast()` directly, which fails loudly — the right behaviour for a
 * screen, which genuinely is inside the provider tree.
 */
