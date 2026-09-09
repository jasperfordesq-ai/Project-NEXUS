// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One titled group of fields on a create/edit form.
 *
 * This is the shape the owner pointed at as the one that works — Create Listing's
 * "Listing basics / Delivery / Media / Organise" cards — lifted out so Create Course,
 * Create Job, the Podcast Studio and Create Opportunity stop being one undivided column
 * of twenty fields. A section is a HeroUI Native `Card` with a small tinted icon and a
 * heading; the fields inside sit on a 16dp rhythm.
 *
 * `FormHero` is the card at the top of those same screens: the tint bar, the icon, the
 * eyebrow / title / subtitle, and optional summary tiles that echo the member's choices as
 * they make them.
 */

import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Card as HeroCard } from 'heroui-native';

import { Ionicons } from '@/components/ui/Icon';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

type IoniconName = keyof typeof Ionicons.glyphMap;

export function FormSection({
  title,
  icon,
  children,
  testID,
}: {
  title: string;
  icon: IoniconName;
  children: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  const primary = usePrimaryColor();
  return (
    <HeroCard variant="default" testID={testID}>
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-center gap-2">
          <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
            <Ionicons name={icon} size={17} color={primary} />
          </View>
          <Text className="min-w-0 flex-1 text-base font-bold" style={{ color: theme.text }} accessibilityRole="header">
            {title}
          </Text>
        </View>
        {children}
      </HeroCard.Body>
    </HeroCard>
  );
}

/** Small uppercase caption above a field that draws its own control (an `Input` without `label`). */
export function FieldLabel({ label }: { label: string }) {
  const theme = useTheme();
  return <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{label}</Text>;
}

/** Inline validation text under a field; pairs with an `Input` whose border is already red. */
export function FieldErrorText({ message, testID }: { message: string; testID?: string }) {
  const theme = useTheme();
  return (
    <Text className="-mt-2 text-xs font-medium" style={{ color: theme.error }} accessibilityRole="alert" testID={testID}>
      {message}
    </Text>
  );
}

export function SummaryTile({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View className="flex-1 rounded-2xl border px-3 py-3" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
      <Text className="text-xs font-semibold uppercase" style={{ color: theme.textMuted }}>{label}</Text>
      <Text className="mt-1 text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

export function FormHero({
  icon,
  eyebrow,
  title,
  subtitle,
  tone,
  children,
}: {
  icon: IoniconName;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Module colour for the tint bar and icon; defaults to the community accent. */
  tone?: string;
  /** Summary tiles, status chips or a primary action rendered under the text. */
  children?: ReactNode;
}) {
  const theme = useTheme();
  const primary = usePrimaryColor();
  const colour = tone ?? primary;
  return (
    <HeroCard variant="default" className="overflow-hidden">
      <View style={{ height: 4, backgroundColor: colour }} />
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(colour, 0.14) }}>
            <Ionicons name={icon} size={23} color={colour} />
          </View>
          <View className="min-w-0 flex-1">
            {eyebrow ? (
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{eyebrow}</Text>
            ) : null}
            <Text className="text-xl font-bold" style={{ color: theme.text }} accessibilityRole="header">{title}</Text>
            {subtitle ? (
              <Text className="mt-1 text-sm leading-5" style={{ color: theme.textMuted }}>{subtitle}</Text>
            ) : null}
          </View>
        </View>
        {children}
      </HeroCard.Body>
    </HeroCard>
  );
}
