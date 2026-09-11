// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Tabs as HeroTabs } from 'heroui-native';
import { forwardRef, type ComponentProps, type ComponentRef } from 'react';

const Trigger = forwardRef<ComponentRef<typeof HeroTabs.Trigger>, ComponentProps<typeof HeroTabs.Trigger>>(
  function NativeTabTrigger({ style, ...props }, ref) {
    return <HeroTabs.Trigger ref={ref} {...props} style={typeof style === 'function'
      ? (state) => [style(state), { minWidth: 48, minHeight: 48 }]
      : [style, { minWidth: 48, minHeight: 48 }]} />;
  },
);

// Do not mutate HeroTabs itself: the wrapper must keep using the original trigger.
export const Tabs = Object.assign(
  forwardRef<ComponentRef<typeof HeroTabs>, ComponentProps<typeof HeroTabs>>(function NativeTabs(props, ref) {
    return <HeroTabs ref={ref} {...props} />;
  }),
  { List: HeroTabs.List, ScrollView: HeroTabs.ScrollView, Trigger, Label: HeroTabs.Label, Indicator: HeroTabs.Indicator, Content: HeroTabs.Content },
);
