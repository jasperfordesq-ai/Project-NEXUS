// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { useCallback, useEffect, useRef } from 'react';
import { Keyboard, View, useWindowDimensions, type TextInput } from 'react-native';
import { BottomSheet as HeroBottomSheet } from 'heroui-native';
import { BottomSheetFooter, BottomSheetScrollView, type BottomSheetFooterProps } from '@gorhom/bottom-sheet';
import { useFocusEffect } from 'expo-router';
import { useBottomInset } from '@/lib/ui/rootInsets';
import { useTheme } from '@/lib/hooks/useTheme';
import { useDeferredBottomSheetState } from './useDeferredBottomSheetState';
import { SheetFormFocusContext, fieldScrollDelta } from './sheetFormFocus';

/**
 * Room left under scrolling content so the last field clears a sticky footer.
 * The footer is one row of buttons plus padding; measured at ~84dp on a 411dp phone.
 */
const FOOTER_CLEARANCE_DP = 96;

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Whether the overlay and a downward swipe may dismiss the sheet. Forms with
   * unsaved or in-flight input should set this false and route closure through
   * their visible Cancel action, where a confirmation can run before the sheet
   * changes state.
   */
  dismissible?: boolean;
  /**
   * Explicit snap points. Numbers are pixel heights (the bottom safe-area inset
   * is added so content isn't clipped by the home indicator); strings are
   * percentages (e.g. '90%'). Omit entirely to let the library size the sheet
   * to its content (dynamic sizing) — no manual height math required.
   */
  snapPoints?: (number | string)[];
  children: React.ReactNode;
  title?: string;
  /**
   * Primary actions that must remain reachable while the body scrolls or the
   * keyboard is open. Rendered directly below the title and outside the
   * scrollable region. Use this for short, high-priority forms whose actions
   * should never depend on reaching the bottom of the sheet.
   */
  headerActions?: React.ReactNode;
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
   * Actions pinned to the bottom of the sheet and clear of the home indicator. Pass a
   * row of buttons; the frame (border, background, insets) is drawn here. For short
   * keyboard-critical forms, prefer `headerActions`: physical Samsung testing showed
   * that a large keyboard toolbar can still make a bottom footer awkward to reach.
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
  headerActions,
  childrenClassName,
  scrollable = false,
  footer,
  testID,
  dismissible = true,
}: BottomSheetProps) {
  const { mounted: sheetMounted, open: sheetOpen, shouldHonorClose } = useDeferredBottomSheetState(visible);
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const viewportRef = useRef<View>(null);
  const scrollRef = useRef<React.ElementRef<typeof BottomSheetScrollView>>(null);
  const focusedInput = useRef<TextInput | null>(null);
  const scrollOffset = useRef(0);
  const revealFrame = useRef<number | null>(null);
  const revealFocusedInput = useCallback(() => {
    if (revealFrame.current !== null) cancelAnimationFrame(revealFrame.current);
    revealFrame.current = requestAnimationFrame(() => {
      revealFrame.current = null;
      const input = focusedInput.current;
      if (!input) return;
      viewportRef.current?.measureInWindow((_x, top, _width, height) => {
        const keyboardTop = Keyboard.metrics()?.screenY ?? Infinity;
        input.measureInWindow((_ix, inputTop, _iw, inputHeight) => {
          if (focusedInput.current !== input) return;
          const delta = fieldScrollDelta(inputTop, inputHeight, top, Math.min(top + height, keyboardTop));
          if (Math.abs(delta) > 1) {
            scrollRef.current?.scrollTo({ y: Math.max(0, scrollOffset.current + delta), animated: false });
          }
        });
      });
    });
  }, []);
  const focusField = useCallback((input: TextInput | null) => {
    focusedInput.current = input;
    if (input) revealFocusedInput();
  }, [revealFocusedInput]);
  useEffect(() => {
    if (!visible) return;
    const subscription = Keyboard.addListener('keyboardDidShow', revealFocusedInput);
    const frameSubscription = Keyboard.addListener('keyboardDidChangeFrame', revealFocusedInput);
    return () => {
      subscription.remove();
      frameSubscription.remove();
      focusedInput.current = null;
      scrollOffset.current = 0;
      if (revealFrame.current !== null) cancelAnimationFrame(revealFrame.current);
    };
  }, [visible, revealFocusedInput]);
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
  const bottomPadding = Math.max(16, bottomInset + 16);
  const contentBottomPadding = footer ? bottomPadding + FOOTER_CLEARANCE_DP : bottomPadding;

  if (!sheetMounted) return null;

  const body = scrollable ? (
    <SheetFormFocusContext.Provider value={focusField}>
      <View
        ref={viewportRef}
        collapsable={false}
        style={hasSnapPoints ? { flex: 1, minHeight: 0 } : undefined}
        onLayout={revealFocusedInput}
      >
        <BottomSheetScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          showsVerticalScrollIndicator
          onScroll={(event) => { scrollOffset.current = event.nativeEvent.contentOffset.y; }}
          onContentSizeChange={revealFocusedInput}
          style={hasSnapPoints ? { flex: 1 } : undefined}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: contentBottomPadding }}
          testID={testID ? `${testID}-scroll` : undefined}
        >
          <View className={childrenClassName}>{children}</View>
        </BottomSheetScrollView>
      </View>
    </SheetFormFocusContext.Provider>
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
        <HeroBottomSheet.Overlay isCloseOnPress={dismissible} className="bg-black/55" />
        <HeroBottomSheet.Content
          snapPoints={resolvedSnapPoints}
          enableDynamicSizing={!hasSnapPoints}
          enableOverDrag={false}
          enablePanDownToClose={dismissible}
          enableContentPanningGesture={!scrollable}
          keyboardBehavior="extend"
          keyboardBlurBehavior="restore"
          android_keyboardInputMode="adjustResize"
          enableBlurKeyboardOnGesture
          contentContainerClassName="bg-background"
          contentContainerProps={hasSnapPoints ? { style: { flex: 1, minHeight: 0 } } : undefined}
          backgroundClassName="rounded-t-[30px] bg-background"
          handleClassName="rounded-t-[30px] bg-background"
          handleIndicatorClassName="bg-muted-foreground/50"
          footerComponent={footer ? (footerProps: BottomSheetFooterProps) => (
            <BottomSheetFooter {...footerProps} bottomInset={bottomInset}>
              <View
                className="border-t border-border px-4 pt-3"
                style={{ backgroundColor: theme.bg, paddingBottom: 12 }}
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
          {headerActions ? (
            <View
              className="border-b border-border px-4 py-3"
              testID={testID ? `${testID}-header-actions` : undefined}
            >
              {headerActions}
            </View>
          ) : null}
          {body}
        </HeroBottomSheet.Content>
      </HeroBottomSheet.Portal>
    </HeroBottomSheet>
  );
}
