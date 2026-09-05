// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { View } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Spinner, Surface, Text } from 'heroui-native';
import { useBottomInset } from '@/lib/ui/rootInsets';
import { useTheme } from '@/lib/hooks/useTheme';
import AccentIcon from '@/components/ui/AccentIcon';

export default function FormActionFooter({
  title,
  subtitle,
  submitLabel,
  secondaryLabel,
  icon = 'checkmark-outline',
  primary,
  isSubmitting,
  isDisabled,
  onSubmit,
  onSecondary,
}: {
  title: string;
  subtitle: string;
  submitLabel: string;
  secondaryLabel?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  primary: string;
  isSubmitting: boolean;
  isDisabled?: boolean;
  onSubmit: () => void;
  onSecondary?: () => void;
}) {
  const theme = useTheme();

  /**
   * 🔴 The actions ALWAYS sit below the text, and they wrap. Both halves of that were
   * arrived at by measurement, not taste.
   *
   * The original layout was [title + subtitle][secondary][primary] on one line. The text
   * block shrank first (`min-w-0 flex-1`), but a button label does not shrink or truncate,
   * so the buttons overflowed. On a 360dp phone the title had collapsed to "Review y…" —
   * three characters — and "Save changes" was still cut off at the edge of the screen.
   *
   * 🔴 A first fix stacked them only below 380dp. Zooming into the 411dp capture then
   * showed "Save changes" clipped THERE TOO, with the pill's rounded edge sliced flat:
   * a useful title needs ~150dp and the two buttons ~250dp, which does not fit the 395dp
   * a 411dp phone actually offers. Like select-tenant.tsx, this was broken at every width
   * and the narrow screen merely made it obvious. A width threshold would have shipped
   * the bug on the majority of phones while looking like a fix.
   *
   * So there is no threshold. The buttons take the full width below the text and simply
   * wrap: side by side where there is room (411dp gives each ~190dp, enough), one per row
   * where there is not (360dp gives ~164dp, measured as not enough). `flexGrow` makes a
   * button fill whatever row it lands on, so neither case looks accidental — and no
   * magic number has to be re-tuned when a translation gets longer.
   */
  // Android modal screens report bottom inset 0 — useBottomInset floors it with
  // the root-recorded inset so the footer clears the system navigation bar.
  const bottomInset = useBottomInset();

  return (
    <Surface
      variant="default"
      className="border-t border-border/50 px-4 pt-3"
      style={{ paddingBottom: Math.max(12, bottomInset) }}
    >
      <View className="gap-3">
        {/*
          🔴 No `flex-1` here. It used to carry `min-w-0 flex-1`, which meant "take the
          leftover WIDTH beside the buttons". In this column it would mean "take the
          leftover HEIGHT from a basis of zero", and an intermediate version of this fix
          collapsed the whole text block to nothing — title and subtitle simply gone from
          the footer, caught on the device. Same trap as select-tenant.tsx: `flex-1` is
          about one axis, and turning the container silently repurposes it.
        */}
        <View>
          <Text className="text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>
            {title}
          </Text>
          <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
        {/* Submit is LAST, so it sits nearest the thumb whether the row wraps or not. */}
        <View className="flex-row flex-wrap gap-2">
          {secondaryLabel && onSecondary ? (
            <HeroButton
              variant="secondary"
              onPress={onSecondary}
              isDisabled={isSubmitting}
              style={{ flexGrow: 1, flexBasis: 'auto' }}
            >
              <HeroButton.Label numberOfLines={1}>{secondaryLabel}</HeroButton.Label>
            </HeroButton>
          ) : null}
          <HeroButton
            variant="primary"
            onPress={onSubmit}
            isDisabled={isSubmitting || isDisabled}
            style={{
              flexGrow: 1,
              flexBasis: 'auto',
              backgroundColor: isSubmitting || isDisabled ? theme.border : primary,
            }}
          >
            {isSubmitting ? <Spinner size="sm" /> : <AccentIcon name={icon} size={16} />}
            <HeroButton.Label numberOfLines={1}>{submitLabel}</HeroButton.Label>
          </HeroButton>
        </View>
      </View>
    </Surface>
  );
}
