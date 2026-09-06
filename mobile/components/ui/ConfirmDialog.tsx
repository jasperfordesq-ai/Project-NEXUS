// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { View } from 'react-native';
import { Button as HeroButton, Dialog, Spinner } from 'heroui-native';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  cancelLabel: string;
  confirmLabel: string;
  cancelAccessibilityLabel?: string;
  confirmAccessibilityLabel?: string;
  cancelTestID?: string;
  confirmTestID?: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  variant?: 'primary' | 'danger';
  isConfirming?: boolean;
  confirmDisabled?: boolean;
}

export default function ConfirmDialog({
  visible,
  title,
  message,
  cancelLabel,
  confirmLabel,
  cancelAccessibilityLabel,
  confirmAccessibilityLabel,
  cancelTestID,
  confirmTestID,
  onClose,
  onConfirm,
  variant = 'danger',
  isConfirming = false,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal unstable_accessibilityContainerViewIsModal>
        <Dialog.Overlay isCloseOnPress className="bg-black/60" />
        <Dialog.Content
          isSwipeable
          className="mx-5 gap-5 rounded-[28px] border border-border bg-background p-5"
        >
          <View className="gap-2">
            <Dialog.Title className="text-xl font-bold text-foreground">
              {title}
            </Dialog.Title>
            {message ? (
              <Dialog.Description className="text-sm leading-5 text-muted-foreground">
                {message}
              </Dialog.Description>
            ) : null}
          </View>

          <View className="flex-row gap-3">
            <HeroButton
              testID={cancelTestID}
              variant="ghost"
              className="min-w-0 flex-1"
              accessibilityLabel={cancelAccessibilityLabel ?? cancelLabel}
              isDisabled={isConfirming}
              onPress={onClose}
            >
              <HeroButton.Label>{cancelLabel}</HeroButton.Label>
            </HeroButton>
            <HeroButton
              testID={confirmTestID}
              variant={variant}
              className="min-w-0 flex-1"
              accessibilityLabel={confirmAccessibilityLabel ?? confirmLabel}
              isDisabled={confirmDisabled || isConfirming}
              onPress={() => void onConfirm()}
            >
              {isConfirming ? <Spinner size="sm" /> : null}
              <HeroButton.Label>{confirmLabel}</HeroButton.Label>
            </HeroButton>
          </View>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
