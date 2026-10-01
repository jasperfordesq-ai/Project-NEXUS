// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  isBrowserOnlyPath,
  isInAppOnlyRoute,
  mapSystemPathToNativeRoute,
  redirectSystemPath,
} from './+native-intent';

describe('native intent route rewriting', () => {
  it('maps Android listing and group app links to implemented modal routes', () => {
    expect(mapSystemPathToNativeRoute('nexus:///listings/90877')).toBe('/(modals)/exchange-detail?id=90877');
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/groups/90106')).toBe('/(modals)/group-detail?id=90106');
  });

  it('maps profile parity links to native member, appreciations, and collections routes', () => {
    expect(mapSystemPathToNativeRoute('/users/25717')).toBe('/(modals)/member-profile?id=25717');
    expect(mapSystemPathToNativeRoute('/users/25717/appreciations')).toBe('/(modals)/appreciations?userId=25717');
    expect(mapSystemPathToNativeRoute('/users/25717/collections')).toBe('/(modals)/profile-collections?userId=25717&scope=public');
    // F-198: the link's `name` is the author's claim; both screens name the member from the server.
    expect(mapSystemPathToNativeRoute('/users/25717/appreciations?name=Community%20Coordinator')).toBe('/(modals)/appreciations?userId=25717');
    expect(mapSystemPathToNativeRoute('/users/25717/collections?name=Community%20Coordinator')).toBe('/(modals)/profile-collections?userId=25717&scope=public');
  });

  it('opens the members Help Centre guide links in the app, and other help links on the help screen', () => {
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/hour-timebank/help/members/wallet/send_hours'))
      .toBe('/(modals)/help-guide?section=wallet&article=send_hours');
    expect(mapSystemPathToNativeRoute('/help/members/wallet')).toBe('/(modals)/help-guide?section=wallet');
    expect(mapSystemPathToNativeRoute('/help/brokers/broker_basics')).toBe('/(modals)/help-faqs');
    expect(mapSystemPathToNativeRoute('/help')).toBe('/(modals)/help-faqs');
  });

  it('keeps the current-member profile link on the Profile tab', () => {
    expect(mapSystemPathToNativeRoute('/profile')).toBe('/(tabs)/profile');
    expect(mapSystemPathToNativeRoute('/profile/25717')).toBe('/(modals)/member-profile?id=25717');
  });

  it('maps the signed-out custom-scheme auth aliases with their tokens intact', () => {
    expect(mapSystemPathToNativeRoute('nexus://reset-password?token=reset-token'))
      .toBe('/(auth)/reset-password?token=reset-token');
    expect(mapSystemPathToNativeRoute('nexus://forgot-password'))
      .toBe('/(auth)/forgot-password');
  });

  it('maps push-producer seller and job workflow links to actionable native screens', () => {
    expect(mapSystemPathToNativeRoute('/marketplace/seller/dashboard')).toBe('/(modals)/marketplace-tools');
    expect(mapSystemPathToNativeRoute('/jobs/44#applications')).toBe('/(modals)/job-pipeline?id=44');
    expect(mapSystemPathToNativeRoute('/jobs/44/applications')).toBe('/(modals)/job-pipeline?id=44');
    expect(mapSystemPathToNativeRoute('/volunteering/7')).toBe('/(modals)/volunteering-detail?id=7');
    expect(mapSystemPathToNativeRoute('/endorsements')).toBe('/(modals)/endorsements');
    expect(mapSystemPathToNativeRoute('/marketplace/offers')).toBe('/(modals)/marketplace-offers');
    expect(mapSystemPathToNativeRoute('/marketplace/tools')).toBe('/(modals)/marketplace-tools');
  });

  it('opens the exact comment surface for supported content notification links', () => {
    expect(mapSystemPathToNativeRoute('/feed/posts/12#comment-91'))
      .toBe('/(modals)/feed-item-detail?openComments=1&commentId=91&type=post&id=12');
    expect(mapSystemPathToNativeRoute('/listings/44#comment-92'))
      .toBe('/(modals)/feed-item-detail?openComments=1&commentId=92&type=listing&id=44');
    expect(mapSystemPathToNativeRoute('/blog/a-good-news-story#comment-93'))
      .toBe('/(modals)/blog-post?openComments=1&commentId=93&id=a-good-news-story');
    expect(mapSystemPathToNativeRoute('/events/45#comment-94'))
      .toBe('/(modals)/feed-item-detail?openComments=1&commentId=94&type=event&id=45');
    expect(mapSystemPathToNativeRoute('/resources/46#comment-95'))
      .toBe('/(modals)/feed-item-detail?openComments=1&commentId=95&type=resource&id=46');
    expect(mapSystemPathToNativeRoute('/volunteering/opportunities/47#comment-96'))
      .toBe('/(modals)/feed-item-detail?openComments=1&commentId=96&type=volunteer&id=47');
    expect(mapSystemPathToNativeRoute('/groups/8?discussion_id=48#comment-97'))
      .toBe('/(modals)/feed-item-detail?discussion_id=48&openComments=1&commentId=97&type=discussion&id=48');
    expect(mapSystemPathToNativeRoute('/events/45#comments'))
      .toBe('/(modals)/feed-item-detail?openComments=1&type=event&id=45');
    expect(mapSystemPathToNativeRoute('/groups/8#discussion-48'))
      .toBe('/(modals)/feed-item-detail?type=discussion&id=48');
  });

  it('maps create aliases to native create surfaces', () => {
    expect(mapSystemPathToNativeRoute('/listings/new')).toBe('/(modals)/new-exchange');
    expect(mapSystemPathToNativeRoute('/events/create')).toBe('/(modals)/new-event');
    expect(mapSystemPathToNativeRoute('/groups/new')).toBe('/(modals)/new-group');
    expect(mapSystemPathToNativeRoute('/polls/new')).toBe('/(modals)/polls?create=1');
    expect(mapSystemPathToNativeRoute('/challenges/new')).toBe('/(modals)/new-challenge');
  });

  it('maps messages and ideation links without going through unmatched routes', () => {
    expect(mapSystemPathToNativeRoute('nexus:///messages/new')).toBe('/(modals)/new-message');
    expect(mapSystemPathToNativeRoute('/messages/new/260?listing=90877')).toBe('/(modals)/thread?listing=90877&recipientId=260');
    // F-118: a link's `name` is the author's claim and is not carried to the thread.
    expect(mapSystemPathToNativeRoute('/messages?user=25717&context=event&context_id=12&name=E2E%20Admin')).toBe(
      '/(modals)/thread?context_id=12&context_type=event&recipientId=25717',
    );
    expect(mapSystemPathToNativeRoute('/ideation/23')).toBe('/(modals)/ideation-detail?id=23');
  });

  it('maps discover and support/legal web aliases to implemented native routes', () => {
    expect(mapSystemPathToNativeRoute('/explore')).toBe('/(tabs)/explore');
    expect(mapSystemPathToNativeRoute('/discover')).toBe('/(tabs)/explore');
    expect(mapSystemPathToNativeRoute('nexus:///support')).toBe('/(modals)/support');
    expect(mapSystemPathToNativeRoute('/legal')).toBe('/(modals)/support');
    expect(mapSystemPathToNativeRoute('/privacy')).toBe('/(modals)/support?doc=privacy');
    expect(mapSystemPathToNativeRoute('/terms')).toBe('/(modals)/support?doc=terms');
    expect(mapSystemPathToNativeRoute('/trust-and-safety')).toBe('/(modals)/support?doc=trust');
    expect(mapSystemPathToNativeRoute('/platform/privacy')).toBe('/(modals)/support?doc=privacy');
  });

  /*
    🔴 CHANGED 2026-10-01 for F-496, deliberately. This test used to be named "preserves
    unknown paths so Expo Router can handle native routes normally" and asserted that
    `redirectSystemPath` returned `/(modals)/exchange-detail?id=90877` unchanged. That
    fail-open IS the finding: the same `null` means "I could not map this" and "my host
    allow-list refused this", so the refusal was being handed to the router. An internal
    `(modals)` spelling only ever arrives from outside the app, because expo-router calls
    `redirectSystemPath` for system URLs only — `router.push` never goes through it.
  */
  it('refuses an internal route spelling that arrived from outside the app', () => {
    expect(mapSystemPathToNativeRoute('/(modals)/exchange-detail?id=90877')).toBeNull();
    expect(redirectSystemPath({ path: '/(modals)/exchange-detail?id=90877', initial: false })).toBe('/');
    // The control: the member-facing link for the same screen still works.
    expect(redirectSystemPath({ path: '/listings/90877', initial: false })).toBe('/(modals)/exchange-detail?id=90877');
  });

  // F-300: the image viewer shows whatever `uri` it is given inside the app's
  // own chrome, so no outside link may open it — any web page or app could
  // otherwise make the member's phone fetch a chosen host and display a chosen
  // picture with a chosen caption. The app opens it itself with router.push.
  it.each([
    'nexus:///(modals)/image-viewer?uri=https://attacker.example/x.png&title=Sign%20in',
    '/(modals)/image-viewer?uri=https://attacker.example/x.png',
    'nexus:///image-viewer?uri=https://attacker.example/x.png',
    '/image-viewer?uri=https://attacker.example/x.png',
    'https://app.project-nexus.ie/image-viewer?uri=https://attacker.example/x.png',
  ])('never opens the image viewer from an outside link: %s', (path) => {
    expect(redirectSystemPath({ path, initial: false })).toBe('/');
  });

  it('rejects untrusted web origins and non-https links', () => {
    expect(mapSystemPathToNativeRoute('https://evil.example/messages/123')).toBeNull();
    expect(mapSystemPathToNativeRoute('http://app.project-nexus.ie/messages/123')).toBeNull();
    expect(mapSystemPathToNativeRoute('javascript:alert(1)')).toBeNull();
  });

  /*
    🔴 Before the native builders existed (2026-09-06), every one of these links was
    swallowed by the `/courses/:id` and `/podcasts/:slug` arms below them: `instructor`
    was read as a course id and `studio` as a show slug, so a shared link to a builder
    opened a detail screen reporting that no such course or show existed. Ordering is
    the whole fix, so these assertions guard the order, not just the mapping.
  */
  /*
    🔴 An input BOUND, from the 2026-09-06 audit's dependency triage. Whatever this
    returns is handed to React Navigation's `getStateFromPath`, which parses the query
    string through `query-string` -> `decode-uri-component@0.2.2`, which carries
    GHSA-vcc3-ghjq-m6fr: malformed percent-encoded input decodes in exponential time. It is
    the one advisory in the production tree that actually ships, and it cannot be patched
    from here - the fixed release is ESM-only and its consumer is CommonJS, so an npm
    override would break every deep link rather than harden one.

    Reachable: app.json claims every https://app.project-nexus.ie/* URL with autoVerify and
    no pathPrefix, so any web page can hand a member an arbitrary link into this function.
  */
  it('refuses an absurdly long link before it can reach the router query parser', () => {
    const hostile = `/listings?q=${'%E0%A4%A'.repeat(600)}`;
    expect(hostile.length).toBeGreaterThan(2048);
    expect(redirectSystemPath({ path: hostile, initial: false })).toBe('/');
  });

  it('refuses a short malformed link before Expo Router can parse it', () => {
    const malformed = '/listings?q=%E0%A4%A';
    expect(malformed.length).toBeLessThan(2048);
    expect(redirectSystemPath({ path: malformed, initial: false })).toBe('/');
  });

  it('keeps the exported link classifiers total for malformed path encoding', () => {
    const malformed = '/%E0%A4%A';
    expect(isBrowserOnlyPath(malformed)).toBe(false);
    expect(mapSystemPathToNativeRoute(malformed)).toBeNull();
  });

  it('leaves a long-but-plausible link alone, so the bound cannot break a real one', () => {
    // The app's longest real link is a password-reset URL with a token, under 200 chars.
    const realistic = `/password/reset/${'a'.repeat(120)}?email=someone%40example.org`;
    expect(realistic.length).toBeLessThan(2048);
    expect(redirectSystemPath({ path: realistic, initial: false })).not.toBe('/');
  });

  it('maps course authoring links to the native builder rather than a course detail', () => {
    expect(mapSystemPathToNativeRoute('/courses/instructor')).toBe('/(modals)/course-instructor');
    expect(mapSystemPathToNativeRoute('/courses/instructor/new')).toBe('/(modals)/new-course');
    expect(mapSystemPathToNativeRoute('/courses/instructor/12/edit')).toBe('/(modals)/new-course?id=12');
    expect(mapSystemPathToNativeRoute('/courses/instructor/12/analytics')).toBe('/(modals)/course-analytics?id=12');
    expect(mapSystemPathToNativeRoute('/courses/instructor/12/grading')).toBe('/(modals)/course-grading?id=12');
  });

  it('still maps ordinary course links, so the instructor arm did not swallow them', () => {
    expect(mapSystemPathToNativeRoute('/courses/basics')).toBe('/(modals)/course-detail?id=basics');
    expect(mapSystemPathToNativeRoute('/courses/12/learn')).toBe('/(modals)/course-player?id=12');
    expect(mapSystemPathToNativeRoute('/courses/my-learning')).toBe('/(modals)/courses?tab=learning');
  });

  it('maps the podcast studio link to the native studio rather than a show slug', () => {
    expect(mapSystemPathToNativeRoute('/podcasts/studio')).toBe('/(modals)/podcast-studio');
    expect(mapSystemPathToNativeRoute('/podcasts/time-stories')).toBe('/(modals)/podcast-show?slug=time-stories');
    expect(mapSystemPathToNativeRoute('/podcasts/time-stories/first-hour'))
      .toBe('/(modals)/podcast-episode?showSlug=time-stories&episodeSlug=first-hour');
  });
});

/*
  🔴 F-496. `redirectSystemPath` used to end `?? path ?? '/'`. `parseSystemPath` returns
  null BOTH when it cannot map a link and when its host allow-list REFUSES one, so the
  refusal was thrown away and the original string was handed to Expo Router. `app.json`
  registers the `nexus` scheme with no host and no path prefix, so any web page, email or
  other app can send one. Measured against the bundled expo-router 55.0.18 matcher,
  `https://evil.example/(modals)/exchange-detail?id=1` resolved to the exchange-detail
  screen, so this is a real door, not a theoretical one.

  🔴 F-497. `IN_APP_ONLY_ROUTES` was compared with a case-sensitive exact `Set.has`, so
  `IMAGE-VIEWER` and `image-viewer%2F` walked past the F-300 refusal into that same door.

  These assert the CORRECT behaviour: a link the mapper does not recognise is refused,
  while every link the app is meant to answer — including Stripe's own payment returns and
  a web page that has no native screen — still goes where it went before.
*/
describe('unmapped deep links are refused rather than handed to the router (F-496/F-497)', () => {
  it.each([
    // The host allow-list refuses these inside parseSystemPath; the refusal must be acted on.
    'https://evil.example/(modals)/exchange-detail?id=1',
    'http://app.project-nexus.ie/(modals)/exchange-detail?id=1',
    // The custom scheme is reachable from any web page and must not be a free pass.
    'nexus://x/(modals)/volunteer-checkin?token=AAAA',
    'nexus:///volunteer-checkin?token=AAAA',
    'nexus:///marketplace-pickup-scan',
    // The app's own internal route spellings. No link from outside the app uses these.
    '/(modals)/marketplace-pickup-scan',
  ])('refuses %s', (path) => {
    expect(redirectSystemPath({ path, initial: false })).toBe('/');
  });

  // F-497, at the gate itself: the spellings must be caught, not just stopped later.
  it.each([
    'nexus:///IMAGE-VIEWER?uri=https://attacker.example/x.png',
    'nexus:///image-viewer%2F?uri=https://attacker.example/x.png',
    'https://app.project-nexus.ie/Image-Viewer?uri=https://attacker.example/x.png',
  ])('treats %s as the in-app-only image viewer', (path) => {
    expect(isInAppOnlyRoute(path)).toBe(true);
    expect(redirectSystemPath({ path, initial: false })).toBe('/');
  });

  // Legitimate-access controls. Each differs from the refused cases only in being a link
  // the app is meant to answer.
  it('still maps the links members actually follow', () => {
    expect(redirectSystemPath({ path: 'https://app.project-nexus.ie/members/42', initial: false }))
      .toBe('/(modals)/member-profile?id=42');
    expect(redirectSystemPath({ path: 'nexus://reset-password?token=abc123', initial: false }))
      .toBe('/(auth)/reset-password?token=abc123');
    expect(redirectSystemPath({ path: '/listings/90877', initial: false }))
      .toBe('/(modals)/exchange-detail?id=90877');
    /*
      Not a fall-through: `parseSystemPath` treats an unrecognised first segment as a
      community slug and looks at the second, so this is MAPPED to the real reset screen
      with its token — the same place `nexus://reset-password?token=…` goes. Asserted so a
      later reader does not mistake it for the refusal above.
    */
    expect(redirectSystemPath({ path: '/(auth)/reset-password?token=AAAA', initial: false }))
      .toBe('/(auth)/reset-password?token=AAAA');
  });

  it("still carries Stripe's own payment return URLs through untouched", () => {
    // lib/payments/marketplacePayment.native.ts and identityPayment.native.ts hand these
    // to Stripe as the 3-D Secure return URL. Refusing one strands a member mid-payment.
    expect(redirectSystemPath({ path: 'nexus:///marketplace-payment-return', initial: false }))
      .toBe('nexus:///marketplace-payment-return');
    expect(redirectSystemPath({ path: 'nexus://marketplace-payment-return', initial: false }))
      .toBe('nexus://marketplace-payment-return');
    expect(redirectSystemPath({ path: 'nexus:///stripe-redirect', initial: false }))
      .toBe('nexus:///stripe-redirect');
  });

  it('still lets a web page with no native screen reach the not-found screen', () => {
    // +not-found offers to open the real page in the browser, and it can only do that
    // because the web path reaches it. +native-intent.coverage.test.ts contracts for this.
    const webOnly = 'https://app.project-nexus.ie/hour-timebank/some-web-only-page';
    expect(redirectSystemPath({ path: webOnly, initial: false })).toBe(webOnly);
  });

  it('still declines browser-only sections unchanged', () => {
    const console_ = 'https://app.project-nexus.ie/admin/dashboard';
    expect(redirectSystemPath({ path: console_, initial: false })).toBe(console_);
  });

  it('still lets an Expo Go development link through', () => {
    // Only Expo Go registers `exp:`; a production build never receives it, because
    // app.json registers https://app.project-nexus.ie and `nexus:` and nothing else.
    const devLink = 'exp://192.168.1.5:8081/--/listings/90877';
    expect(redirectSystemPath({ path: devLink, initial: false })).toBe(devLink);
  });
});
