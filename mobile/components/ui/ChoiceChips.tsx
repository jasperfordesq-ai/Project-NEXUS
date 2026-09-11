// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The one way this app offers a short list of options to pick from — a category, a level,
 * a visibility, a job type, a sort order.
 *
 * 🔴 Why this exists, measured on a device on 2026-09-09. Eleven screens built their pickers
 * on HeroUI Native's `TagGroup size="sm"`. A small tag is `p-0.5 px-2 text-xs`, which
 * renders about 20dp tall — below the WCAG 2.2 AA minimum target (24dp) and less than half
 * Android's own 48dp guidance. Its selected state is a pale accent tint, and every one of
 * those screens then painted the selected label `contrastText(primary)` — white, on most
 * communities — so the chosen option was white text on a pale wash. The owner's words:
 * "the places you press to pick a category are tiny, and they don't get highlighted".
 *
 * The Create Listing screen never had the problem because it used HeroUI Native's `Button`
 * (`size="sm"` = 40dp, a full accent fill when selected, and the library picks the label
 * colour that contrasts with THAT community's accent). This component is that idiom, shared,
 * with the target raised to 48dp so it clears both guidelines.
 *
 * Rules, all guarded by tests:
 *  - one component for single AND multiple selection, so the two never drift apart again;
 *  - every chip is at least `MIN_TARGET_DP` tall and reports `accessibilityState.selected`;
 *  - chips wrap onto new rows — a horizontal strip hides options off the right edge, which
 *    is how a 360dp phone lost the last job type;
 *  - nothing in here hardcodes a label colour. HeroUI's `primary` variant chooses it from
 *    the community's `--accent-foreground`, which is the whole point of not using
 *    `contrastText()` for a fill the library owns.
 *
 * `components/choiceChipsMigration.test.ts` forbids `TagGroup` under app/ and components/
 * so the tiny picker cannot come back one screen at a time.
 */

import { View, Text } from 'react-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';

import { useTheme } from '@/lib/hooks/useTheme';
import { CHROME_MAX_FONT_SCALE } from '@/lib/ui/textScale';

/** Use the larger native target so the same control works on both platforms. */
export const MIN_TARGET_DP = 48;

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  /** Read out instead of `label` when the visible text alone is ambiguous ("1-10"). */
  accessibilityLabel?: string;
  disabled?: boolean;
}

interface CommonProps<T extends string> {
  /** Small uppercase caption above the chips. Omit when the caller draws its own label. */
  label?: string;
  options: readonly ChoiceOption<T>[];
  testID?: string;
  /** Extra classes for the wrapping row (spacing only — never sizing). */
  className?: string;
}

interface SingleProps<T extends string> extends CommonProps<T> {
  selectionMode?: 'single';
  selected: T | '' | null | undefined;
  /**
   * Receives the tapped value. With `allowDeselect`, tapping the chosen chip again sends
   * `''` — the shape optional fields (experience level, equipment) want.
   */
  onSelect: (value: T | '') => void;
  allowDeselect?: boolean;
}

interface MultipleProps<T extends string> extends CommonProps<T> {
  selectionMode: 'multiple';
  selected: readonly T[];
  onSelectionChange: (values: T[]) => void;
}

export type ChoiceChipsProps<T extends string> = SingleProps<T> | MultipleProps<T>;

/** Turn a flat list of values into options with a label function. */
export function toOptions<T extends string>(
  values: readonly T[],
  labelFor: (value: T) => string,
): ChoiceOption<T>[] {
  return values.map((value) => ({ value, label: labelFor(value) }));
}

export default function ChoiceChips<T extends string>(props: ChoiceChipsProps<T>) {
  const theme = useTheme();
  const { label, options, testID, className } = props;
  const isMultiple = props.selectionMode === 'multiple';

  function isSelected(value: T): boolean {
    return isMultiple ? props.selected.includes(value) : props.selected === value;
  }

  function handlePress(value: T) {
    if (isMultiple) {
      const next = props.selected.includes(value)
        ? props.selected.filter((item) => item !== value)
        : [...props.selected, value];
      props.onSelectionChange(next);
      return;
    }
    if (props.selected === value) {
      if (props.allowDeselect) props.onSelect('');
      return;
    }
    props.onSelect(value);
  }

  return (
    <View className="gap-2" testID={testID}>
      {label ? (
        <Text
          className="text-xs font-bold uppercase"
          style={{ color: theme.textSecondary }}
          maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
        >
          {label}
        </Text>
      ) : null}
      <View
        className={`flex-row flex-wrap gap-2 ${className ?? ''}`}
        accessibilityRole={isMultiple ? undefined : 'radiogroup'}
      >
        {options.map((option) => {
          const selected = isSelected(option.value);
          return (
            <HeroButton
              key={option.value}
              size="sm"
              variant={selected ? 'primary' : 'secondary'}
              isDisabled={option.disabled}
              onPress={() => handlePress(option.value)}
              accessibilityLabel={option.accessibilityLabel ?? option.label}
              accessibilityState={{ selected, disabled: Boolean(option.disabled) }}
              testID={testID ? `${testID}-${option.value}` : undefined}
              /*
                🔴 Sizing lives in `style`, not a class. HeroUI Native's Button animates
                its root, and the library's own start-up notice says animated styles win
                over className — the same reason `Input` puts its fill in `style`. `h-auto`
                lets a long category name wrap to two lines instead of clipping.
              */
              className="h-auto"
              style={{ minHeight: MIN_TARGET_DP, paddingVertical: 10, paddingHorizontal: 16 }}
            >
              <HeroButton.Label maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                {option.label}
              </HeroButton.Label>
            </HeroButton>
          );
        })}
      </View>
    </View>
  );
}
