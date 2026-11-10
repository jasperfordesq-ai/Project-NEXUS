// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useId } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Ionicons } from '@/components/ui/Icon';
import { coverColours } from '@/lib/theme/itemColours';
import { useColourScheme } from '@/lib/theme/useItemColours';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const ICON_SIZE = { sm: 22, md: 34, lg: 48 } as const;
const TILE_PADDING = { sm: 8, md: 12, lg: 16 } as const;

interface ItemCoverProps {
  /** A colour name from `itemColours` (a theme's colour, or one from the community palette). */
  colour: string;
  /** What the item is (an offer, an event, a group…). Leave out for a plain band. */
  icon?: IoniconName;
  size?: keyof typeof ICON_SIZE;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * What a card or page shows in place of a photo — the app's copy of the
 * website's `ThemedCover` (AWID feedback, Nov 2026: "attractive visuals"): a
 * soft gradient in the item's own colour (the same colour the website gives
 * it), a soft light in one corner, and an icon on a frosted square.
 *
 * Decoration only — the card's own text says what the item is — so screen
 * readers skip it. Drawn with react-native-svg, which every build of the app
 * already contains, so this needs no new native module. Fills the box it is
 * given: pass a height (and width, if not full width) in `style`.
 */
export default function ItemCover({ colour, icon, size = 'md', style, testID }: ItemCoverProps) {
  const scheme = useColourScheme();
  const cover = coverColours(colour, scheme);
  // react-native-svg resolves url(#id) per drawing, but keep ids unique and plain anyway.
  const gradientId = `cover${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <View
      style={[{ overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, style]}
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Svg style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={cover.stops[0]} stopOpacity={cover.opacities[0]} />
            <Stop offset="0.5" stopColor={cover.stops[1]} stopOpacity={cover.opacities[1]} />
            <Stop offset="1" stopColor={cover.stops[2]} stopOpacity={cover.opacities[2]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
        {/* A soft light in the top corner. */}
        <Circle cx="100%" cy="0" r="38%" fill="#ffffff" fillOpacity={scheme === 'light' ? 0.35 : 0.04} />
      </Svg>
      {icon ? (
        <View
          testID={testID ? `${testID}-icon` : undefined}
          style={{
            padding: TILE_PADDING[size],
            borderRadius: 16,
            backgroundColor: cover.iconTile,
            borderWidth: 1,
            borderColor: scheme === 'light' ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.1)',
          }}
        >
          {/* Full strength (the website fades it a little): itemColours.contrast.test.ts measures this colour. */}
          <Ionicons name={icon} size={ICON_SIZE[size]} color={cover.foreground} />
        </View>
      ) : null}
    </View>
  );
}
