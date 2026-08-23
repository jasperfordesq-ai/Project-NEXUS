// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';

import BottomSheet from '@/components/ui/BottomSheet';
import Button from '@/components/ui/Button';
import { useTheme } from '@/lib/hooks/useTheme';

interface Action {
  label: string;
  icon?: string;
  onPress: () => void;
  destructive?: boolean;
}

interface ActionSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  actions: Action[];
}

export default function ActionSheet({ visible, onClose, title, actions }: ActionSheetProps) {
  const theme = useTheme();

  // No manual snap-point height math — with no snapPoints the BottomSheet
  // wrapper uses dynamic sizing, so the sheet fits the action list exactly
  // (and never clips or leaves dead space).
  const handleAction = (action: Action) => {
    onClose();
    // Let the close animation start before the action fires (it may navigate
    // or open another surface).
    setTimeout(() => action.onPress(), 200);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <View className="pt-1">
        {actions.map((action, index) => (
          <Button
            key={index}
            variant="ghost"
            className={`w-full justify-start rounded-none py-4${index < actions.length - 1 ? ' border-b border-black/10' : ''}`}
            onPress={() => handleAction(action)}
            accessibilityLabel={action.label}
          >
            {/*
              🔴 The row height and the text's line height are set in `style`, not left to
              the classes. Measured on a device on 2026-08-22: every label in this menu was
              clipped through the middle of its glyphs — "Share", "Save", "Report" all cut in
              half — because the row took its height from the button's own padding while the
              text needed more. It looked like a rendering fault in the sheet and was not.
              An explicit minimum height plus an explicit line height fixes every row at
              once, and `numberOfLines` keeps a long label (a muted member's full name) on
              one line instead of pushing the row over.
            */}
            <View className="flex-row items-center" style={{ minHeight: 44 }}>
              {action.icon ? (
                <Ionicons
                  name={action.icon as keyof typeof Ionicons.glyphMap}
                  size={22}
                  color={action.destructive ? theme.error : theme.text}
                  style={{ marginRight: 14 }}
                />
              ) : null}
              <Text
                className={`text-base font-medium${action.destructive ? ' text-danger' : ' text-foreground'}`}
                style={{ lineHeight: 22 }}
                numberOfLines={1}
              >
                {action.label}
              </Text>
            </View>
          </Button>
        ))}
      </View>
    </BottomSheet>
  );
}
