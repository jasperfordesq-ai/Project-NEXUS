// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button as HeroButton } from 'heroui-native';
import { forwardRef, isValidElement, type ComponentProps, type ComponentRef } from 'react';
import { Platform, useWindowDimensions, type AccessibilityState } from 'react-native';

type HeroButtonProps = ComponentProps<typeof HeroButton>;

/**
 * The words a screen reader takes from the inside of a button: text pieces join as written,
 * separate parts are separate words, a part with its own label is read by that label, and a
 * part hidden from screen readers is skipped. Anything else (an icon, a spinner) says nothing.
 */
function spokenTextOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) {
    return node.map((part) => (isValidElement(part) ? ` ${spokenTextOf(part)} ` : spokenTextOf(part))).join('');
  }
  if (!isValidElement(node)) return '';
  const props = node.props as Record<string, unknown>;
  if (
    props.accessibilityElementsHidden === true
    || props['aria-hidden'] === true
    || props.importantForAccessibility === 'no-hide-descendants'
  ) {
    return '';
  }
  const ownLabel = props.accessibilityLabel ?? props['aria-label'];
  if (typeof ownLabel === 'string') return ownLabel;
  return spokenTextOf(props.children);
}

/**
 * 🔴 On Android, React Native writes "busy" into a view's description when
 * accessibilityState.busy turns true on a view with no accessibilityLabel, and never clears
 * it when busy turns false: BaseViewManager.updateViewContentDescription only writes a
 * description that has words in it. TalkBack then said "busy" instead of the button's words
 * for as long as the screen stayed open, e.g. "Verify and turn on" after a wrong code and the
 * welcome wizard's Next after the profile was saved (Android 16 emulator, 7 November 2026).
 *
 * So a button that reports busy always carries its own words as its label, and Android
 * rebuilds the description as "Next" or "Next, busy". On Android a button with no words to
 * say does not report busy at all, rather than be left saying only "busy". Buttons that never
 * report busy are passed through exactly as they were.
 */
function nameForBusy(
  children: unknown,
  accessibilityLabel: HeroButtonProps['accessibilityLabel'],
  accessibilityState: HeroButtonProps['accessibilityState'],
): Pick<HeroButtonProps, 'accessibilityLabel' | 'accessibilityState'> {
  // No busy to report, or an animated label (any label already keeps the name): as it was.
  if (!reportsBusy(accessibilityState) || (accessibilityLabel != null && typeof accessibilityLabel !== 'string')) {
    return { accessibilityLabel, accessibilityState };
  }
  const label = accessibilityLabel ?? (spokenTextOf(children).replace(/\s+/g, ' ').trim() || undefined);
  if (label) return { accessibilityLabel: label, accessibilityState };
  // Nothing to say. Only Android pins "busy" on the view, so only there is busy left out.
  if (Platform.OS !== 'android') return { accessibilityLabel, accessibilityState };
  const withoutBusy: AccessibilityState = { ...accessibilityState };
  delete withoutBusy.busy;
  return { accessibilityLabel, accessibilityState: withoutBusy };
}

/** A plain accessibilityState that mentions busy. An animated one never does, so it passes as it is. */
function reportsBusy(state: HeroButtonProps['accessibilityState']): state is AccessibilityState {
  return state != null && typeof state === 'object' && Object.prototype.hasOwnProperty.call(state, 'busy');
}

const NativeButtonLabel = forwardRef<ComponentRef<typeof HeroButton.Label>, ComponentProps<typeof HeroButton.Label>>(
  function NativeButtonLabel({ style, ...props }, ref) {
    const { fontScale } = useWindowDimensions();
    // Android can retain old text measurements after Settings changes font size.
    // Remount only the label, preserving the button and surrounding form state.
    return <HeroButton.Label key={fontScale} ref={ref} {...props} style={[{ flexShrink: 1, textAlign: 'center' }, style]} />;
  },
);

/**
 * Let scaled and translated labels wrap without losing the minimum touch target, and keep a
 * busy button's name (see nameForBusy).
 */
const NativeButton = forwardRef<ComponentRef<typeof HeroButton>, ComponentProps<typeof HeroButton>>(
  function NativeButton({ style, children, accessibilityLabel, accessibilityState, ...props }, ref) {
    const sizing = {
      minWidth: 48,
      minHeight: props.size === 'lg' ? 56 : 48,
      ...(!props.isIconOnly ? { height: 'auto' as const, paddingVertical: 10 } : {}),
    };
    const named = nameForBusy(children, accessibilityLabel, accessibilityState);
    return (
      <HeroButton
        ref={ref}
        {...props}
        accessibilityLabel={named.accessibilityLabel}
        accessibilityState={named.accessibilityState}
        style={typeof style === 'function'
          ? (state) => [style(state), sizing]
          : [style, sizing]}
      >
        {typeof children === 'string' || typeof children === 'number'
          ? <NativeButtonLabel>{children}</NativeButtonLabel>
          : children}
      </HeroButton>
    );
  },
);

export const Button = Object.assign(NativeButton, { Label: NativeButtonLabel });
