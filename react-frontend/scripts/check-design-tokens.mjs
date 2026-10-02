// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(frontendRoot, 'src');

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.css']);
const RAW_BRAND_UTILITY = /(?<![A-Za-z0-9_-])(?:[\w-]+:)*(?:-)?(?:bg|text|border(?:-[trblxyse])?|divide(?:-[xy])?|ring(?:-offset)?|outline|shadow|inset-shadow|drop-shadow|fill|stroke|decoration|caret|placeholder|accent|from|via|to)-(?:indigo|purple)-(?:950|900|800|700|600|500|400|300|200|100|50)(?:\/[\w.\[\]-]+)?/g;

const inlineStyleExceptionGroups = [
  {
    reason: 'Data-driven chart, progress, and analytics geometry cannot be expressed by a finite Tailwind class.',
    files: {
      'src/admin/modules/advertising/PushCampaignAdminPage.tsx': 2,
      'src/admin/modules/analytics/CommunityAnalytics.tsx': 1,
      'src/admin/modules/analytics/RegionalAnalyticsPage.tsx': 3,
      'src/admin/modules/billing/RevenueDashboard.tsx': 1,
      'src/admin/modules/dashboard/AdminDashboard.tsx': 1,
      'src/admin/modules/gamification/GamificationAnalytics.tsx': 1,
      'src/admin/modules/gamification/GamificationHub.tsx': 1,
      'src/admin/modules/jobs/JobBiasAudit.tsx': 1,
      'src/admin/modules/newsletters/NewsletterStats.tsx': 1,
      'src/admin/modules/performance/PerformanceDashboard.tsx': 1,
      'src/components/compose/shared/CharacterCount.tsx': 1,
      'src/components/feed/FeedCard.tsx': 1,
      'src/components/feed/PostAnalyticsModal.tsx': 1,
      'src/components/listings/ListingAnalyticsPanel.tsx': 1,
      'src/components/podcasts/PodcastMiniPlayer.tsx': 1,
      'src/components/podcasts/PodcastShowStatsPanel.tsx': 1,
      'src/components/ui/LevelProgress.tsx': 1,
      'src/pages/activity/ActivityDashboardPage.tsx': 2,
      'src/pages/caring-community/FutureCareFundPage.tsx': 4,
      'src/pages/events/EventDetailPage.tsx': 1,
      'src/pages/leaderboard/PersonalJourneyTab.tsx': 1,
      'src/pages/messages/components/VoiceMessagePlayer.tsx': 1,
      'src/pages/nexus-score/NexusScorePage.tsx': 1,
      'src/pages/partner-analytics/PartnerDashboardPage.tsx': 1,
    },
  },
  {
    reason: 'Data-derived hierarchy depth requires a runtime logical indentation value.',
    files: {
      'src/admin/modules/billing/BillingControl.tsx': 1,
      'src/admin/modules/super/TenantHierarchy.tsx': 1,
      'src/pages/groups/tabs/GroupWikiTab.tsx': 1,
      'src/pages/resources/ResourcesPage.tsx': 1,
    },
  },
  {
    reason: 'Tenant, administrator, or member-selected colors must be rendered from persisted user data.',
    files: {
      'src/admin/modules/categories/CategoriesAdmin.tsx': 3,
      'src/admin/modules/groups/GroupOrganization.tsx': 1,
      'src/admin/modules/groups/GroupTypes.tsx': 1,
      'src/admin/modules/system/AdminSettings.tsx': 1,
      'src/components/branding/TenantLogo.tsx': 1,
      'src/components/layout/ThemePicker.tsx': 1,
      'src/components/social/SaveButton.tsx': 1,
      'src/components/ui/ConfettiCelebration.tsx': 1,
      'src/components/wallet/CategorySelect.tsx': 1,
      'src/pages/groups/components/GroupBrandingPicker.tsx': 3,
      'src/pages/groups/components/GroupHeader.tsx': 1,
      'src/pages/groups/GroupsPage.tsx': 1,
      'src/pages/profile/CollectionDetailPage.tsx': 1,
      'src/pages/profile/MyCollectionsPage.tsx': 1,
      'src/pages/profile/UserCollectionsView.tsx': 1,
    },
  },
  {
    reason: 'User-authored story media needs persisted transforms, filters, fonts, gradients, and sticker coordinates.',
    files: {
      'src/components/stories/StoryCreator.tsx': 12,
      'src/components/stories/StoryHighlights.tsx': 1,
      'src/components/stories/StoryViewer.tsx': 7,
    },
  },
  {
    reason: 'Third-party rendering or component interoperability requires runtime dimensions, transforms, or style forwarding.',
    files: {
      'src/admin/modules/content/MenuBuilder.tsx': 1,
      'src/components/compose/MediaUploader.tsx': 1,
      'src/components/location/EntityMapView.tsx': 2,
      'src/components/location/LocationMap.tsx': 3,
      'src/components/location/LocationMapCard.tsx': 1,
      'src/components/location/OpenStreetMapView.tsx': 1,
      'src/components/marketplace/ListingLocationMap.tsx': 1,
      'src/components/marketplace/MapSearchView.tsx': 2,
      'src/components/social/MentionAutocomplete.tsx': 1,
      'src/components/social/YouTubeEmbed.tsx': 1,
      'src/components/ui/Input.tsx': 3,
      'src/components/ui/Textarea.tsx': 3,
      'src/components/volunteering/QrCodeImage.tsx': 2,
    },
  },
  {
    reason: 'Runtime component geometry is calculated from the selected logo shape or requested control size.',
    files: {
      'src/admin/modules/enterprise/GdprDashboard.tsx': 1,
      'src/components/layout/Layout.tsx': 1,
    },
  },
  {
    reason: 'Viewport-measured geometry (soft-keyboard inset, edge-clamping shift) is computed at runtime and forwarded as CSS custom properties.',
    files: {
      'src/components/social/ReactionPickerMenu.tsx': 1,
      'src/pages/chat/AiChatPage.tsx': 1,
      'src/pages/messages/ConversationPage.tsx': 1,
    },
  },
  {
    reason: 'The fatal bootstrap fallback must remain readable before React and the application stylesheet are available.',
    files: {
      'src/main.tsx': 4,
    },
  },
];

function normalizePath(filePath) {
  return path.relative(frontendRoot, filePath).replaceAll(path.sep, '/');
}

function isProductionSource(filePath) {
  const relative = normalizePath(filePath);
  const name = path.basename(filePath);
  return !relative.split('/').some((segment) => segment === '__tests__' || segment === 'test')
    && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name)
    && !name.endsWith('.d.ts');
}

function collectFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectFiles(filePath, files);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && isProductionSource(filePath)) {
      files.push(filePath);
    }
  }
  return files;
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function buildInlineStyleAllowlist() {
  const allowlist = new Map();
  for (const group of inlineStyleExceptionGroups) {
    for (const [file, count] of Object.entries(group.files)) {
      if (allowlist.has(file)) {
        throw new Error(`Duplicate inline-style exception: ${file}`);
      }
      allowlist.set(file, { count, reason: group.reason });
    }
  }
  return allowlist;
}

function countInlineStyles(filePath, source) {
  if (!/\.[jt]sx$/.test(filePath)) return 0;
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  let count = 0;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.text === 'style') count += 1;
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return count;
}

const failures = [];
const files = collectFiles(srcRoot);
const actualInlineStyles = new Map();

for (const filePath of files) {
  const source = fs.readFileSync(filePath, 'utf8');
  for (const match of source.matchAll(RAW_BRAND_UTILITY)) {
    failures.push(`${normalizePath(filePath)}:${lineNumberAt(source, match.index)} raw brand utility "${match[0]}"`);
  }

  const count = countInlineStyles(filePath, source);
  if (count > 0) actualInlineStyles.set(normalizePath(filePath), count);
}

const inlineStyleAllowlist = buildInlineStyleAllowlist();
for (const [file, count] of actualInlineStyles) {
  const exception = inlineStyleAllowlist.get(file);
  if (!exception) {
    failures.push(`${file} has ${count} unapproved inline style attribute(s)`);
  } else if (exception.count !== count) {
    failures.push(`${file} inline-style count changed: expected ${exception.count}, found ${count}; migrate it or update the documented exception`);
  }
}
for (const [file, exception] of inlineStyleAllowlist) {
  if (!actualInlineStyles.has(file)) {
    failures.push(`${file} no longer needs its ${exception.count}-style exception; remove the stale allowlist entry`);
  }
}

const tokensPath = path.join(srcRoot, 'styles', 'tokens.css');
const tokens = fs.readFileSync(tokensPath, 'utf8');
if (!tokens.includes('--color-accent-gradient-end: var(--accent-gradient-end);')) {
  failures.push('src/styles/tokens.css is missing the Tailwind bridge for --accent-gradient-end');
}
if (/\.(?:bg|text|border|from|via|to)-(?:indigo|purple)-/.test(tokens)) {
  failures.push('src/styles/tokens.css reintroduced a global indigo/purple utility remap');
}

if (failures.length > 0) {
  console.error('Design-token contract failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const inlineCount = [...actualInlineStyles.values()].reduce((sum, count) => sum + count, 0);
console.log(`Design-token contract passed: 0 raw indigo/purple utilities; ${inlineCount} approved dynamic inline styles across ${actualInlineStyles.size} files.`);
