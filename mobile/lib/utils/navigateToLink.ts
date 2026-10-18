// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Linking } from 'react-native';
import { router, type Href } from 'expo-router';
import { mapSystemPathToNativeRoute } from '@/app/+native-intent';
import { reportException, reportMessage, safeLinkSummary } from '@/lib/observability/report';
import { isSafeExternalBrowserLink } from '@/lib/utils/safeExternalLink';
import { isNativeHrefDisabled } from '@/lib/navigation/tenantCapabilityStore';
import { sessionNoticeStore } from '@/lib/notices/sessionNoticeStore';
// The i18next singleton, not '@/lib/i18n' — same reason as lib/utils/dateLocale.ts.
import i18n from 'i18next';

/**
 * Navigate a platform web/custom-scheme link through the same canonical mapper used by
 * Android App Links and iOS Universal Links. Keeping one route contract prevents push taps
 * from lagging behind newer native modules while cold-start App Links continue to work.
 */
/**
 * What the call did. The root navigator holds its "default to Home" rule back only
 * after `'navigated'`: the render that follows a push still reports the previous
 * pathname, and acting on it replaced the screen the link had just opened.
 */
export type NavigateToLinkResult = 'navigated' | 'external' | 'ignored';

export function navigateToLink(link: string | null): NavigateToLinkResult {
  if (!link) return 'ignored';

  if (isSafeExternalBrowserLink(link)) {
    void Linking.openURL(link).catch((error) => {
      reportException(error, { tags: { module: 'push-external-cta' } });
    });
    return 'external';
  }

  const mappedHref = mapSystemPathToNativeRoute(link);
  if (!mappedHref) {
    reportMessage(
      '[DeepLink] Unhandled link',
      { link: safeLinkSummary(link) },
      'deeplink-unhandled'
    );
    return 'ignored';
  }
  if (isNativeHrefDisabled(mappedHref)) {
    /*
      The community has switched this module off. This used to push the notifications
      list — which, tapped FROM the notifications list, stacked a second copy of the same
      screen on top of the first (audit 2026-09-07, B/F-11). Say so where the member is
      instead; nothing about a disabled module is improved by moving them.
    */
    sessionNoticeStore.publish({
      title: i18n.t('common:featureUnavailable.title'),
      description: i18n.t('common:featureUnavailable.subtitle'),
      variant: 'warning',
    });
    return 'ignored';
  }

  const target = routerTarget(mappedHref);
  if (mappedHref.startsWith('/(tabs)/') || mappedHref.startsWith('/(auth)/')) {
    router.replace(target);
  } else {
    router.push(target);
  }
  return 'navigated';
}

function routerTarget(mappedHref: string): Href {
  const queryIndex = mappedHref.indexOf('?');
  if (queryIndex === -1) return mappedHref as Href;

  const pathname = mappedHref.slice(0, queryIndex);
  const search = mappedHref.slice(queryIndex + 1);
  return {
    pathname,
    params: Object.fromEntries(new URLSearchParams(search).entries()),
  } as Href;
}
