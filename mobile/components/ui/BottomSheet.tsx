// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { useCallback, useRef } from 'react';
import { View } from 'react-native';
import { BottomSheet as HeroBottomSheet } from 'heroui-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getRootBottomInset } from '@/lib/ui/rootInsets';
import { useDeferredBottomSheetState } from './useDeferredBottomSheetState';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Explicit snap points. Numbers are pixel heights (the bottom safe-area inset
   * is added so content isn't clipped by the home indicator); strings are
   * percentages (e.g. '90%'). Omit entirely to let the library size the sheet
   * to its content (dynamic sizing) — no manual height math required.
   */
  snapPoints?: (number | string)[];
  children: React.ReactNode;
  title?: string;
  childrenClassName?: string;
}

export default function BottomSheet({
  visible,
  onClose,
  snapPoints,
  children,
  title,
  childrenClassName,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { mounted: sheetMounted, open: sheetOpen, shouldHonorClose } = useDeferredBottomSheetState(visible);

  /**
   * 🔴 Close when the screen underneath goes away.
   *
   * A sheet renders through a portal at the app root, so it does NOT disappear when the
   * screen that opened it is navigated away from. Measured on 2026-08-22: the group
   * "start a discussion" sheet was still sitting on top of an EVENT detail screen after a
   * deep link, over completely unrelated content, and the member's only way out was to
   * swipe a sheet that no longer belonged to anything on screen.
   *
   * Only visible before 2026-08-21, when sheets began opening at all — which is why it had
   * never been seen.
   *
   * `visibleRef` keeps the effect from re-subscribing on every open/close: the cleanup
   * needs the value at BLUR time, not at subscribe time.
   */
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useFocusEffect(
    useCallback(
      () => () => {
        if (visibleRef.current) onCloseRef.current();
      },
      [],
    ),
  );

  // Inside Android `presentation: 'modal'` screens useSafeAreaInsets()
  // reports bottom: 0, which put sheet footers underneath the system nav
  // bar. Fall back to the inset recorded at the app root.
  const bottomInset = Math.max(insets.bottom, getRootBottomInset());

  // With explicit snap points, honour them (numbers get the bottom inset added
  // so content isn't clipped). With none, let the library size the sheet to its
  // content — no magic height math, no clipping, no dead space.
  const hasSnapPoints = Array.isArray(snapPoints) && snapPoints.length > 0;
  const resolvedSnapPoints = hasSnapPoints
    ? snapPoints!.map((point) => (typeof point === 'number' ? point + bottomInset : point))
    : undefined;
  const bottomPadding = Math.max(16, bottomInset + 16);

  if (!sheetMounted) return null;

  return (
    <HeroBottomSheet
      isOpen={sheetOpen}
      onOpenChange={(open) => {
        // shouldHonorClose() filters the library's spurious mount-time close
        // event (see useDeferredBottomSheetState) that made sheets need
        // multiple taps to open.
        if (!open && shouldHonorClose()) onClose();
      }}
    >
      <HeroBottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <HeroBottomSheet.Overlay isCloseOnPress className="bg-black/55" />
        <HeroBottomSheet.Content
          snapPoints={resolvedSnapPoints}
          enableDynamicSizing={!hasSnapPoints}
          enableOverDrag={false}
          keyboardBehavior="extend"
          keyboardBlurBehavior="restore"
          contentContainerClassName={hasSnapPoints ? 'h-full bg-background' : 'bg-background'}
          backgroundClassName="rounded-t-[30px] bg-background"
          handleClassName="rounded-t-[30px] bg-background"
          handleIndicatorClassName="bg-muted-foreground/50"
        >
          {title ? (
            <View className="items-center border-b border-border px-4 pb-3 pt-2">
              <HeroBottomSheet.Title className="text-center">{title}</HeroBottomSheet.Title>
            </View>
          ) : null}
          <View
            className={`px-4 ${hasSnapPoints ? 'flex-1 ' : ''}${childrenClassName ?? ''}`}
            style={{ paddingBottom: bottomPadding }}
          >
            {children}
          </View>
        </HeroBottomSheet.Content>
      </HeroBottomSheet.Portal>
    </HeroBottomSheet>
  );
}
