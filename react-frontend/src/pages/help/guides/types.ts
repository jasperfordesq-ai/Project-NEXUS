// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Built-in Help Centre guides.
 *
 * The STRUCTURE of the guides (which sections and articles exist, their
 * order, icons, which feature switch each depends on and which page each
 * article is about) lives in the `data/*.registry.json` files. The TEXT lives
 * in the `help_members`, `help_brokers` and `help_admins` translation
 * namespaces under `sections.<section>.title|summary` and
 * `sections.<section>.articles.<article>.title|summary|body`, so every guide
 * is translated like the rest of the app.
 */

export const HELP_AUDIENCES = ['members', 'brokers', 'admins'] as const;

export type HelpAudience = (typeof HELP_AUDIENCES)[number];

/** Translation namespace holding each audience's guide text. */
export const HELP_AUDIENCE_NAMESPACE: Record<HelpAudience, string> = {
  members: 'help_members',
  brokers: 'help_brokers',
  admins: 'help_admins',
};

export type HelpGateTerm = { feature: string } | { module: string };

/** A section or article is shown only when its gate is open (null = always). */
export type HelpGate = HelpGateTerm | { any: HelpGateTerm[] } | null;

export type HelpIconName =
  | 'rocket' | 'user' | 'shield' | 'list' | 'message' | 'handshake' | 'wallet'
  | 'users' | 'calendar' | 'newspaper' | 'heart' | 'building' | 'briefcase'
  | 'store' | 'graduation' | 'trophy' | 'globe' | 'bell' | 'bot' | 'wrench'
  | 'clipboard' | 'scale' | 'settings' | 'lifebuoy' | 'book' | 'eye' | 'file'
  | 'sparkles' | 'flag' | 'key' | 'smartphone' | 'accessibility' | 'chart'
  | 'mail' | 'lock' | 'search' | 'layers';

export interface HelpArticleEntry {
  id: string;
  /** App page the article is about, for the "Go to this page" button. */
  link?: string | null;
  gate?: HelpGate;
  popular?: boolean;
}

export interface HelpSectionEntry {
  id: string;
  icon: HelpIconName;
  gate?: HelpGate;
  articles: HelpArticleEntry[];
}

export interface HelpGateContext {
  hasFeature: (feature: string) => boolean;
  hasModule: (module: string) => boolean;
}
