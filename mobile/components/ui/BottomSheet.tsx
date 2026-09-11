// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, View, useWindowDimensions } from 'react-native';
import { BottomSheet as HeroBottomSheet } from 'heroui-native';
import { BottomSheetFooter, BottomSheetScrollView, type BottomSheetFooterProps } from '@gorhom/bottom-sheet';
import { useFocusEffect } from 'expo-router';
import { useBottomInset } from '@/lib/ui/rootInsets';
import { useTheme } from '@/lib/hooks/useTheme';
import { useDeferredBottomSheetState } from './useDeferredBottomSheetState';

/**
 * Room left under scrolling content so the last field clears a sticky footer.
 * The footer is one row of buttons plus padding; measured at ~84dp on a 411dp phone.
 */
const FOOTER_CLEARANCE_DP = 96;

/**
 * The Android keyboard's height while it is open, else 0.
 *
 * 🔴 Measured on the emulator on 2026-09-09: with the Goals composer's title field focused,
 * the sheet did not move and neither did its footer — Cancel and Create sat behind the
 * keys. Neither of gorhom's two Android modes changed that here: the window does not
 * resize under this app's root (the screen behind the sheet keeps its full height when the
 * keyboard opens), and the sheet's own keyboard animation does not run inside HeroUI
 * Native's portal. So the wrapper measures the keyboard itself and lifts the footer and
 * the scroll padding by that amount. iOS is left to gorhom, whose interactive keyboard
 * handling works there.
 */
function useAndroidKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', (event) => setHeight(event.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

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
  /**
   * 🔴 Set this on EVERY sheet that holds a form or a list.
   *
   * Content taller than the sheet then scrolls, using `BottomSheetScrollView` from
   * `@gorhom/bottom-sheet` — the only scroll view the sheet does not swallow. HeroUI
   * Native's own docs say a plain React Native `ScrollView` inside a sheet lets the
   * sheet intercept the drag, and that is exactly what the Goals composer, the podcast
   * edit sheets and the job application sheet did: the member dragged the sheet up and
   * down while the fields underneath never moved.
   *
   * Measured on 2026-09-09: the Goals "Add goal" sheet opened its keyboard on the title
   * field, the description and target fields sat under the keyboard, and nothing the
   * member did could reach them. `components/ui/sheetContentRules.test.ts` now requires
   * this on any sheet that contains a text field.
   */
  scrollable?: boolean;
  /**
   * Actions pinned to the bottom of the sheet, above the keyboard and the home
   * indicator, so they are reachable however far the member has scrolled. Pass a row of
   * buttons; the frame (border, background, insets) is drawn here.
   */
  footer?: React.ReactNode;
  testID?: string;
}

export default function BottomSheet({
  visible,
  onClose,
  snapPoints,
  children,
  title,
  childrenClassName,
  scrollable = false,
  footer,
  testID,
}: BottomSheetProps) {
  const { mounted: sheetMounted, open: sheetOpen, shouldHonorClose } = useDeferredBottomSheetState(visible);
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  useEffect(() => {
    if (!visible) return undefined;
    // Closing or unmounting an active form must release its keyboard too.
    // An initially hidden sheet must not dismiss another screen's keyboard.
    return () => Keyboard.dismiss();
  }, [visible]);

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
  const bottomInset = useBottomInset();

  // With explicit snap points, honour them (numbers get the bottom inset added
  // so content isn't clipped). With none, let the library size the sheet to its
  // content — no magic height math, no clipping, no dead space.
  const hasSnapPoints = Array.isArray(snapPoints) && snapPoints.length > 0;
  const resolvedSnapPoints = hasSnapPoints
    ? snapPoints!.map((point) => (typeof point === 'number' ? point + bottomInset : point))
    : undefined;
  const keyboardHeight = useAndroidKeyboardHeight();
  const bottomPadding = Math.max(16, bottomInset + 16);
  const contentBottomPadding = (footer ? bottomPadding + FOOTER_CLEARANCE_DP : bottomPadding) + keyboardHeight;

  if (!sheetMounted) return null;

  const body = scrollable ? (
    <BottomSheetScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: contentBottomPadding }}
      testID={testID ? `${testID}-scroll` : undefined}
    >
      <View className={childrenClassName}>{children}</View>
    </BottomSheetScrollView>
  ) : (
    <View
      className={`px-4 ${hasSnapPoints ? 'flex-1 ' : ''}${childrenClassName ?? ''}`}
      style={{ paddingBottom: contentBottomPadding }}
    >
      {children}
    </View>
  );

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
          footerComponent={footer ? (footerProps: BottomSheetFooterProps) => (
            <BottomSheetFooter {...footerProps} bottomInset={bottomInset}>
              <View
                className="border-t border-border px-4 pt-3"
                style={{ backgroundColor: theme.bg, paddingBottom: 12 + keyboardHeight }}
                testID={testID ? `${testID}-footer` : undefined}
              >
                {footer}
              </View>
            </BottomSheetFooter>
          ) : undefined}
        >
          {title ? (
            <View className="items-center border-b border-border px-4 pb-3 pt-2">
              <HeroBottomSheet.Title key={fontScale} className="text-center">{title}</HeroBottomSheet.Title>
            </View>
          ) : null}
          {body}
        </HeroBottomSheet.Content>
      </HeroBottomSheet.Portal>
    </HeroBottomSheet>
  );
}
