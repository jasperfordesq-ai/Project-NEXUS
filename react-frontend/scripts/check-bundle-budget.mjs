// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { gzipSync } from 'node:zlib';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const distRoot = path.resolve(import.meta.dirname, '..', 'dist');
const distDir = path.resolve(import.meta.dirname, '..', 'dist', 'assets');
const indexHtmlPath = path.resolve(import.meta.dirname, '..', 'dist', 'index.html');
const serviceWorkerPath = path.resolve(import.meta.dirname, '..', 'dist', 'sw.js');

const budgets = {
  mainJsGzipBytes: 200 * 1024,
  mainCssGzipBytes: 100 * 1024,
  adminLocaleJsonBytes: 8 * 1024,
  authRouteStaticJsGzipBytes: 420 * 1024,
  // Raw bytes; transfer remains compressed. This fits only the startup graph
  // and install metadata, not route/editor chunks.
  serviceWorkerPrecacheBytes: 2 * 1024 * 1024,
};

const disallowedShellPreloads = [
  {
    pattern: /vendor-(?:heroui|react-aria)-/,
    message: 'index.html must not modulepreload HeroUI/React Aria chunks; UI primitives should load with the route surface that needs them.',
  },
  {
    pattern: /vendor-charts-/,
    message: 'index.html must not modulepreload vendor-charts; charts should stay route/admin loaded.',
  },
  {
    pattern: /GoogleMapsProvider-|OpenStreetMapView-|LocationMap-/,
    message: 'index.html must not modulepreload map chunks; maps should load only on map/location workflows.',
  },
  {
    pattern: /sentry-/,
    message: 'index.html must not modulepreload Sentry; telemetry should load after first paint/idle or on demand.',
  },
  {
    pattern: /(?:vendor-(?:grapesjs|codemirror)|PageDesignBuilder|NewsletterBuilder|HtmlSourceEditor)-/,
    message: 'index.html must not modulepreload editor code; visual/HTML editors belong only to explicit admin editing flows.',
  },
];

const forbiddenOrdinaryRouteEditorAsset = /^(?:vendor-(?:grapesjs|codemirror)|PageDesignBuilder|NewsletterBuilder|HtmlSourceEditor)-[^/]+\.(?:js|css)$/i;

const startupImportBudgets = [
  {
    file: 'src/App.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'App.tsx must import startup UI pieces directly, not through the full @/components/ui barrel.',
  },
  {
    file: 'src/App.tsx',
    pattern: /lazyWithRetry|import\(['"]@\/pages\/|from ['"]@\/pages\//,
    message: 'App.tsx must keep the route registry and page dynamic-import map in src/routes/AppRoutes.tsx so the startup chunk stays small.',
  },
  {
    file: 'src/index.css',
    pattern: /@source\s+not\s+["']\.\/(?:admin|broker|caring|partners|super-admin)\/\*\*\//,
    message: 'src/index.css must include panel source folders in the main Tailwind scan; late-loaded panel utility stylesheets corrupt the member header/footer after returning from admin.',
  },
  {
    file: 'src/index.css',
    pattern: /^(?![\s\S]*@source\s+not\s+["']\.\/\*\*\/\*\.d\.ts["'];)/,
    message: 'src/index.css must exclude generated TypeScript declaration files from the Tailwind scan so generated translation/type metadata cannot create CSS candidates.',
  },
  {
    file: 'src/index.css',
    pattern: /^(?![\s\S]*@source\s+not\s+["']\.\/test\/\*\*\/\*\.\{js,ts,jsx,tsx\}["'];)/,
    message: 'src/index.css must exclude src/test from the production Tailwind scan so test-only utilities cannot bloat the app stylesheet.',
  },
  {
    file: 'src/index.css',
    pattern: /^(?![\s\S]*@source\s+not\s+["']\.\/\*\*\/__tests__\/\*\*\/\*\.\{js,ts,jsx,tsx\}["'];)/,
    message: 'src/index.css must exclude __tests__ folders from the production Tailwind scan so test-only fixtures cannot bloat the app stylesheet.',
  },
  {
    file: 'src/admin/AdminApp.tsx',
    pattern: /import\s+['"]\.\/admin\.css['"]/,
    message: 'AdminApp.tsx must not import a lazy global admin stylesheet; panel utilities belong in the main Tailwind stylesheet to protect the member shell after admin navigation.',
  },
  {
    file: 'src/broker/BrokerApp.tsx',
    pattern: /import\s+['"]\.\/broker\.css['"]/,
    message: 'BrokerApp.tsx must not import a lazy global broker stylesheet; panel utilities belong in the main Tailwind stylesheet to protect the member shell after panel navigation.',
  },
  {
    file: 'src/caring/CaringApp.tsx',
    pattern: /import\s+['"]\.\/caring\.css['"]/,
    message: 'CaringApp.tsx must not import a lazy global caring stylesheet; panel utilities belong in the main Tailwind stylesheet to protect the member shell after panel navigation.',
  },
  {
    file: 'src/partners/PartnersApp.tsx',
    pattern: /import\s+['"]\.\/partners\.css['"]/,
    message: 'PartnersApp.tsx must not import a lazy global partners stylesheet; panel utilities belong in the main Tailwind stylesheet to protect the member shell after panel navigation.',
  },
  {
    file: 'src/super-admin/SuperAdminApp.tsx',
    pattern: /import\s+['"]\.\/super-admin\.css['"]/,
    message: 'SuperAdminApp.tsx must not import a lazy global super-admin stylesheet; panel utilities belong in the main Tailwind stylesheet to protect the member shell after panel navigation.',
  },
  {
    file: 'src/main.tsx',
    pattern: /from ['"]@\/lib\/sentry['"]/,
    message: 'main.tsx must lazy-load the Sentry wrapper after first paint/idle instead of importing it on the startup path.',
  },
  {
    file: 'src/main.tsx',
    pattern: /\binitSentry\(/,
    message: 'main.tsx must not initialize Sentry directly before render; use idle-after-mount telemetry loading.',
  },
  {
    file: 'src/contexts/AuthContext.tsx',
    pattern: /import\(['"]@\/lib\/sentry['"]\)/,
    message: 'AuthContext.tsx must queue routine auth telemetry instead of importing the Sentry wrapper during bootstrap.',
  },
  {
    file: 'src/contexts/AuthContext.tsx',
    pattern: /from ['"]@\/lib\/webauthn['"]/,
    message: 'AuthContext.tsx must lazy-load WebAuthn helpers only when a passkey action runs.',
  },
  {
    file: 'src/contexts/TenantContext.tsx',
    pattern: /import\(['"]@\/lib\/sentry['"]\)/,
    message: 'TenantContext.tsx must queue tenant telemetry instead of importing the Sentry wrapper during bootstrap.',
  },
  {
    file: 'src/lib/api.ts',
    pattern: /import\(['"]@\/lib\/sentry['"]\)/,
    message: 'api.ts must queue routine API telemetry instead of importing the Sentry wrapper for startup API calls.',
  },
  {
    file: 'src/i18n.ts',
    pattern: /import\(['"]@\/lib\/sentry['"]\)/,
    message: 'i18n.ts must queue missing-key telemetry so translation misses cannot import Sentry during startup.',
  },
  {
    file: 'src/lib/logger.ts',
    pattern: /import\(['"]@\/lib\/sentry['"]\)/,
    message: 'logger.ts must queue production error telemetry so early logs cannot import Sentry during startup.',
  },
  {
    file: 'src/pages/auth/LoginPage.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'LoginPage.tsx must not import the full @/components/ui barrel on the auth startup path.',
  },
  {
    file: 'src/pages/auth/LoginPage.tsx',
    pattern: /from ['"]@\/lib\/webauthn['"]/,
    message: 'LoginPage.tsx must lazy-load WebAuthn helpers after passkey intent so SimpleWebAuthn does not compete with login startup.',
  },
  {
    file: 'src/lib/telemetryQueue.ts',
    pattern: /^(?![\s\S]*isAuthEntryPath)/,
    message: 'telemetryQueue.ts must suppress routine Sentry flushes on auth-entry routes so returning analytics-consented users do not load telemetry during login/register startup.',
  },
  {
    file: 'src/pages/auth/RegisterPage.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'RegisterPage.tsx must not import the full @/components/ui barrel on the auth startup path.',
  },
  {
    file: 'src/pages/auth/RegisterPage.tsx',
    pattern: /from ['"]@\/components\/location['"]/,
    message: 'RegisterPage.tsx must lazy-load location autocomplete instead of importing the Google Maps/location barrel on the auth startup path.',
  },
  {
    file: 'src/components/location/PlaceAutocompleteInput.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'PlaceAutocompleteInput.tsx can be pulled into auth and create flows, so it must avoid the full @/components/ui barrel.',
  },
  {
    file: 'src/components/location/PlaceAutocompleteInput.tsx',
    pattern: /@vis\.gl\/react-google-maps|GoogleMapsProvider/,
    message: 'PlaceAutocompleteInput.tsx must keep Google Maps provider code in the lazy GooglePlaceAutocomplete branch.',
  },
  {
    file: 'src/components/location/LocationMapCard.tsx',
    pattern: /import\s+\{\s*LocationMap\b/,
    message: 'LocationMapCard.tsx must lazy-load LocationMap so profile/event/group detail pages do not fetch map code unless a map is actually shown.',
  },
  {
    file: 'src/pages/listings/ListingsPage.tsx',
    pattern: /^import\s+(?!type\b).*from ['"]@\/components\/location\/EntityMapView['"]/m,
    message: 'ListingsPage.tsx must lazy-load EntityMapView so default grid/list browsing does not download map-wrapper code.',
  },
  {
    file: 'src/pages/listings/ListingsPage.tsx',
    pattern: /^import\s+(?!type\b).*from ['"]@\/components\/proximity\/ProximityFilter['"]/m,
    message: 'ListingsPage.tsx must lazy-load ProximityFilter so the default browse page does not download advanced-filter-only UI.',
  },
  {
    file: 'src/pages/members/MembersPage.tsx',
    pattern: /^import\s+(?!type\b).*from ['"]@\/components\/location\/EntityMapView['"]/m,
    message: 'MembersPage.tsx must lazy-load EntityMapView so default grid/list browsing does not download map-wrapper code.',
  },
  {
    file: 'src/pages/events/EventsPage.tsx',
    pattern: /^import\s+(?!type\b).*from ['"]@\/components\/proximity\/ProximityFilter['"]/m,
    message: 'EventsPage.tsx must lazy-load ProximityFilter so the public events route chunk stays focused on event browsing.',
  },
  {
    file: 'src/pages/volunteering/VolunteeringPage.tsx',
    pattern: /^import\s+(?!type\b).*from ['"]@\/components\/proximity\/ProximityFilter['"]/m,
    message: 'VolunteeringPage.tsx must lazy-load ProximityFilter so the public volunteering route chunk stays focused on opportunity browsing.',
  },
  {
    file: 'src/pages/volunteering/VolunteeringPage.tsx',
    pattern: /^import\s+(?!type\b).*from ['"]\.\/(?:RecommendedShiftsTab|EmergencyAlertsTab|CertificatesTab|WellbeingTab|CredentialVerificationTab|WaitlistTab|ShiftSwapsTab|GroupSignUpTab|VolunteeringWelcome)['"]/m,
    message: 'VolunteeringPage.tsx must lazy-load signed-in/tab-specific volunteering modules so the public opportunities route stays light.',
  },
  {
    file: 'src/pages/volunteering/VolunteeringPage.tsx',
    pattern: /^import\s+(?!type\b).*from ['"]@\/components\/volunteering\/GuardianConsentModal['"]/m,
    message: 'VolunteeringPage.tsx must lazy-load GuardianConsentModal only after guardian consent is actually requested.',
  },
  {
    file: 'src/pages/auth/ForgotPasswordPage.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'ForgotPasswordPage.tsx must not import the full @/components/ui barrel on the auth startup path.',
  },
  {
    file: 'src/pages/auth/ResetPasswordPage.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'ResetPasswordPage.tsx must not import the full @/components/ui barrel on the auth startup path.',
  },
  {
    file: 'src/pages/auth/VerifyEmailPage.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'VerifyEmailPage.tsx must not import the full @/components/ui barrel on the auth startup path.',
  },
  {
    file: 'src/pages/auth/VerifyIdentityPage.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'VerifyIdentityPage.tsx must not import the full @/components/ui barrel on the auth startup path.',
  },
  {
    file: 'src/pages/auth/OauthCallbackPage.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'OauthCallbackPage.tsx must not import the full @/components/ui barrel on the auth startup path.',
  },
  {
    file: 'src/components/auth/SsoButtons.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'SsoButtons.tsx renders on auth pages, so it must avoid the full @/components/ui barrel.',
  },
  {
    file: 'src/components/auth/OAuthButtons.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'OAuthButtons.tsx renders on auth pages, so it must avoid the full @/components/ui barrel.',
  },
  {
    file: 'src/components/auth/PasswordStrength.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'PasswordStrength.tsx renders on the register page, so it must avoid the full @/components/ui barrel.',
  },
  {
    file: 'src/contexts/ToastContext.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'ToastContext.tsx is mounted globally, so it must avoid the full @/components/ui barrel.',
  },
  {
    file: 'src/i18n.ts',
    pattern: /STARTUP_NAMESPACES[\s\S]*['"](?:admin|broker|legal|public|settings|marketplace|feed|listings|groups|events)['"]/,
    message: 'i18n startup namespaces must stay auth-shell sized; route/page/panel namespaces should lazy-load from their components.',
  },
  {
    file: 'src/i18n.ts',
    pattern: /expirationTime:\s*60\s*\*\s*60\s*\*\s*1000/,
    message: 'production locale localStorage cache must stay longer than one hour; build-hash prefixes already invalidate stale translations.',
  },
  {
    file: 'vite.config.ts',
    pattern: /cacheName:\s*['"]nexus-locales['"][\s\S]{0,180}maxAgeSeconds:\s*86400/,
    message: 'service-worker locale runtime cache must stay longer than one day; locale URLs are build-versioned and should be repeat-visit friendly.',
  },
  {
    file: 'src/pages/settings/VerifyIdentityOptionalPage.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'VerifyIdentityOptionalPage.tsx must not import the full @/components/ui barrel on the identity startup path.',
  },
  {
    file: 'src/components/LanguageSwitcher.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'LanguageSwitcher.tsx renders on auth pages, so it must avoid the full @/components/ui barrel.',
  },
  {
    file: 'src/components/seo/PageMeta.tsx',
    pattern: /from ['"]@\/contexts['"]/,
    message: 'PageMeta.tsx is reachable from TenantShell startup and must import TenantContext directly instead of the @/contexts barrel.',
  },
  {
    file: 'src/components/layout/SourceRepositoryLink.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'SourceRepositoryLink.tsx renders in the auth footer, so it must avoid the full @/components/ui barrel.',
  },
  {
    file: 'src/components/routing/TenantShell.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'TenantShell.tsx is on every route startup path, so it must avoid the full @/components/ui barrel.',
  },
  {
    file: 'src/components/routing/TenantShell.tsx',
    pattern: /from ['"]@\/contexts\/(?:NotificationsContext|PusherContext|MenuContext|PresenceContext|PodcastPlayerContext)['"]|from ['"]@\/components\/security\/IdleLogoutGuard['"]/,
    message: 'TenantShell.tsx must lazy-load app-only runtime providers so login/register do not download realtime/menu/presence/podcast code.',
  },
  {
    file: 'src/components/routing/TenantShell.tsx',
    pattern: /const\s+appRoutesModulePromise\s*=\s*import\(['"]@\/routes\/AppRoutes['"]\)|import\(['"]@\/routes\/AppRoutes['"]\)[\s\S]*import\(['"]@\/routes\/AuthRoutes['"]\)/,
    message: 'TenantShell.tsx must route-split AuthRoutes from AppRoutes so auth pages do not download the full app route registry.',
  },
  {
    file: 'src/routes/AppRoutes.tsx',
    pattern: /from ['"]@\/components\/layout\/AuthLayout['"]|@\/pages\/auth\/(?:LoginPage|RegisterPage|ForgotPasswordPage|ResetPasswordPage|VerifyEmailPage|VerifyIdentityPage|OauthCallbackPage)/,
    message: 'AppRoutes.tsx must not carry auth layout/page imports; auth-entry routes live in src/routes/AuthRoutes.tsx.',
  },
  {
    file: 'src/components/routing/FeatureGate.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'FeatureGate.tsx is imported by shared routing surfaces, so it must avoid the full @/components/ui barrel.',
  },
  {
    file: 'src/components/compose/ComposeHub.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'ComposeHub.tsx must import shell UI pieces directly so opening the composer does not pull the full @/components/ui barrel.',
  },
  {
    file: 'src/components/compose/ComposeHub.tsx',
    pattern: /from ['"]\.\/tabs\/(?:EventTab|GoalTab|ListingTab|PollTab|PostTab)['"]/,
    message: 'ComposeHub.tsx must lazy-load compose tabs so opening one compose workflow does not download every tab implementation.',
  },
  {
    file: 'src/pages/feed/FeedPage.tsx',
    pattern: /from ['"]@\/components\/compose['"]/,
    message: 'FeedPage.tsx must lazy-load ComposeHub so visiting the feed does not download the composer until it is opened.',
  },
  {
    file: 'src/pages/feed/FeedPage.tsx',
    pattern: /from ['"]@\/components\/feed\/sidebar(?:\/index)?['"]/,
    message: 'FeedPage.tsx must lazy-load the desktop sidebar so mobile/feed-first visits do not download sidebar widgets.',
  },
  {
    file: 'src/components/feed/FeedCard.tsx',
    pattern: /from ['"]@\/components\/social\/CommentsSection['"]/,
    message: 'FeedCard.tsx must lazy-load CommentsSection so the first feed list does not download threaded-comment UI before comments are opened.',
  },
  {
    file: 'src/components/feed/FeedCard.tsx',
    pattern: /from ['"]@\/components\/social['"]/,
    message: 'FeedCard.tsx must not import the @/components/social barrel because it re-exports optional feed surfaces such as comments and analytics.',
  },
  {
    file: 'src/components/feed/FeedCard.tsx',
    pattern: /^import\s+(?!type\b).*from ['"](?:\.\/(?:ImageCarousel|MediaGrid|VideoPlayer|QuotedPostEmbed)|@\/components\/social\/LinkPreviewCard)['"]/m,
    message: 'FeedCard.tsx must lazy-load optional media, link-preview, and quote-embed renderers so plain text feed items stay light.',
  },
  {
    file: 'src/components/feed/ShareButton.tsx',
    pattern: /^import\s+(?!type\b).*from ['"]\.\/(?:QuotePostModal|ExternalShareModal|ShareViaDMModal)['"]/m,
    message: 'ShareButton.tsx must lazy-load share modals so ordinary feed cards do not download modal workflows before interaction.',
  },
  {
    file: 'src/components/feed/FeedCard.tsx',
    pattern: /from ['"]@\/components\/social\/UserHoverCard['"]/,
    message: 'FeedCard.tsx must use DeferredUserHoverCard so profile hover popovers load only after desktop hover intent.',
  },
  {
    file: 'src/components/feed/FeedCard.tsx',
    pattern: /from ['"]\.\/PostAnalyticsModal['"]/,
    message: 'FeedCard.tsx must lazy-load PostAnalyticsModal so ordinary feed cards do not download post analytics UI.',
  },
  {
    file: 'src/components/social/ReactionSummary.tsx',
    pattern: /from ['"]@\/lib\/api['"]|from ['"]@\/components\/ui\/(?:Modal|Tabs|Avatar|Spinner)['"]/,
    message: 'ReactionSummary.tsx must keep the reactor-details modal and API lookup in the lazy ReactionDetailsModal chunk.',
  },
  {
    file: 'src/components/social/ReactionSummary.tsx',
    pattern: /^import\s+(?!type\b).*from ['"]\.\/ReactionDetailsModal['"]/m,
    message: 'ReactionSummary.tsx must lazy-load ReactionDetailsModal so feed cards do not download the reaction-details modal before it is opened.',
  },
  {
    file: 'src/components/social/ReactionSummary.tsx',
    pattern: /from ['"]\.\/ReactionPicker['"]/,
    message: 'ReactionSummary.tsx must import reaction constants from ./reactions so summary rows do not couple to the interactive picker.',
  },
  {
    file: 'src/components/social/ReactionDetailsModal.tsx',
    pattern: /from ['"]\.\/ReactionPicker['"]/,
    message: 'ReactionDetailsModal.tsx must import reaction constants from ./reactions so the lazy details chunk stays decoupled from the picker.',
  },
  {
    file: 'src/components/social/BookmarkButton.tsx',
    pattern: /from ['"]\.\/BookmarkCollectionPicker['"]/,
    message: 'BookmarkButton.tsx must lazy-load BookmarkCollectionPicker so ordinary feed cards do not download collection-management UI before long-press.',
  },
  {
    file: 'src/components/social/BookmarkButton.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'BookmarkButton.tsx renders in feed cards, so it must import only the UI primitives it uses instead of the full @/components/ui barrel.',
  },
  {
    file: 'src/components/social/BookmarkCollectionPicker.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'BookmarkCollectionPicker.tsx must import focused UI primitives so its lazy chunk does not pull the full @/components/ui barrel.',
  },
  {
    file: 'src/components/social/ReactionPicker.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'ReactionPicker.tsx renders in feed cards, so it must import only the UI primitives it uses instead of the full @/components/ui barrel.',
  },
  {
    file: 'src/components/social/ReactionPicker.tsx',
    pattern: /from ['"]@\/lib\/motion['"]|from ['"]@\/components\/ui\/Tooltip['"]/,
    message: 'ReactionPicker.tsx must keep motion/tooltip popup code in the lazy ReactionPickerMenu chunk.',
  },
  {
    file: 'src/components/social/ReactionPicker.tsx',
    pattern: /^import\s+(?!type\b).*from ['"]\.\/ReactionPickerMenu['"]/m,
    message: 'ReactionPicker.tsx must lazy-load ReactionPickerMenu so feed cards do not download the emoji popup before hover or long-press.',
  },
  {
    file: 'src/hooks/useSocialInteractions.ts',
    pattern: /@\/components\/social\/ReactionPicker/,
    message: 'useSocialInteractions must import reaction constants from the pure reactions module, not the interactive ReactionPicker component.',
  },
  {
    file: 'src/components/layout/Layout.tsx',
    pattern: /from ['"]@\/components\/(?:podcasts\/PodcastMiniPlayer|caring-community\/EmergencyAlertBanner|legal\/FadpConsentBanner|feedback\/FloatingReportProblemButton)['"]/,
    message: 'Layout.tsx must lazy-load rare global surfaces behind feature/auth gates so ordinary app routes do not bundle them into shared layout chrome.',
  },
  {
    file: 'src/components/feedback/LoadingScreen.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'LoadingScreen.tsx renders on suspense fallbacks and must avoid the full @/components/ui barrel.',
  },
  {
    file: 'src/components/feedback/ErrorBoundary.tsx',
    pattern: /from ['"]@\/components\/ui['"]|import\s+\{?\s*ReportProblemButton/,
    message: 'ErrorBoundary.tsx is mounted by App.tsx; import primitives directly and lazy-load crash-only report UI.',
  },
  {
    file: 'src/components/feedback/FeatureErrorBoundary.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'FeatureErrorBoundary.tsx is shared route fallback UI and must avoid the full @/components/ui barrel.',
  },
  {
    file: 'src/components/feedback/CookieConsentBanner.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'CookieConsentBanner.tsx is mounted from TenantShell and must avoid the full @/components/ui barrel.',
  },
  {
    file: 'src/components/feedback/CookieConsentBanner.tsx',
    pattern: /from ['"]@\/contexts['"]/,
    message: 'CookieConsentBanner.tsx must use direct context imports so the contexts barrel cannot pull app-only providers into the delayed banner chunk.',
  },
  {
    file: 'src/components/layout/AuthLayout.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'AuthLayout.tsx must keep auth chrome lightweight by avoiding the full @/components/ui barrel; focused HeroUI-backed primitives are allowed.',
  },
  {
    file: 'src/components/ui/GlassCard.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'GlassCard.tsx is a UI primitive and must not import the full @/components/ui barrel recursively.',
  },
  {
    file: 'src/admin/AdminApp.tsx',
    pattern: /useTranslation\([^)]*['"]admin['"]/,
    message: 'AdminApp.tsx must not preload the monolithic admin locale namespace.',
  },
  {
    file: 'src/admin/AdminLayout.tsx',
    pattern: /useTranslation\([^)]*['"]admin['"]/,
    message: 'AdminLayout.tsx must not preload the monolithic admin locale namespace.',
  },
  {
    file: 'src/admin/components/AdminBreadcrumbs.tsx',
    pattern: /useTranslation\([^)]*['"]admin['"]/,
    message: 'AdminBreadcrumbs.tsx must use admin_nav, not the monolithic admin namespace.',
  },
  {
    file: 'src/admin/components/AdminHeader.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'AdminHeader.tsx must import only the UI primitives it renders, not the full shared UI barrel.',
  },
  {
    file: 'src/admin/components/AdminSidebar.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'AdminSidebar.tsx must import only the UI primitives it renders, not the full shared UI barrel.',
  },
  {
    file: 'src/admin/components/PageHeader.tsx',
    pattern: /useTranslation\([^)]*['"]admin['"]/,
    message: 'PageHeader.tsx is shared admin chrome and must use admin_nav, not the monolithic admin namespace.',
  },
  {
    file: 'src/admin/components/PageHeader.tsx',
    pattern: /^import\s+(?!type\b)[^\n]*from ['"]\.\.\/data\/helpContent['"]|import\s+\{?\s*HELP_CONTENT/m,
    message: 'PageHeader.tsx must lazy-load the contextual help registry after render instead of bundling it into every admin page.',
  },
  {
    file: 'src/admin/components/PageHeader.tsx',
    pattern: /import\s+\{?\s*AdminHelpDrawer|from ['"]\.\/AdminHelpDrawer['"]/,
    message: 'PageHeader.tsx must lazy-load the help drawer only when contextual help is opened.',
  },
  {
    file: 'src/admin/components/StatCard.tsx',
    pattern: /useTranslation\([^)]*['"]admin['"]/,
    message: 'StatCard.tsx is shared admin chrome and must use admin_nav, not the monolithic admin namespace.',
  },
  {
    file: 'src/admin/components/StatCard.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'StatCard.tsx must import only the UI primitives it renders, not the full shared UI barrel.',
  },
  {
    file: 'src/admin/components/AdminHelpDrawer.tsx',
    pattern: /useTranslation\([^)]*['"]admin['"]/,
    message: 'AdminHelpDrawer.tsx must use admin_nav so opening contextual help does not fetch the monolithic admin namespace.',
  },
  {
    file: 'src/admin/components/AdminHelpDrawer.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'AdminHelpDrawer.tsx must import only the UI primitives it renders, not the full shared UI barrel.',
  },
  {
    file: 'src/admin/components/DataTable.tsx',
    pattern: /useTranslation\([^)]*['"]admin['"]/,
    message: 'DataTable.tsx is shared admin chrome and must use admin_nav, not the monolithic admin namespace.',
  },
  {
    file: 'src/admin/components/DataTable.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'DataTable.tsx must import only the UI primitives it renders, not the full shared UI barrel.',
  },
  {
    file: 'src/admin/components/BulkActionToolbar.tsx',
    pattern: /useTranslation\([^)]*['"]admin['"]/,
    message: 'BulkActionToolbar.tsx is shared admin chrome and must use admin_nav, not the monolithic admin namespace.',
  },
  {
    file: 'src/admin/components/BulkActionToolbar.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'BulkActionToolbar.tsx must import only the UI primitives it renders, not the full shared UI barrel.',
  },
  {
    file: 'src/admin/components/IconPicker.tsx',
    pattern: /useTranslation\([^)]*['"]admin['"]/,
    message: 'IconPicker.tsx is shared admin chrome and must use admin_nav, not the monolithic admin namespace.',
  },
  {
    file: 'src/admin/components/IconPicker.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'IconPicker.tsx must import only the UI primitives it renders, not the full shared UI barrel.',
  },
  {
    file: 'src/admin/components/VisibilityRulesEditor.tsx',
    pattern: /useTranslation\([^)]*['"]admin['"]/,
    message: 'VisibilityRulesEditor.tsx is shared admin chrome and must use admin_nav, not the monolithic admin namespace.',
  },
  {
    file: 'src/admin/components/VisibilityRulesEditor.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'VisibilityRulesEditor.tsx must import only the UI primitives it renders, not the full shared UI barrel.',
  },
  {
    file: 'src/admin/modules/newsletters/NewsletterDesignStudio.tsx',
    pattern: /^import\s+(?!type\b)[^\n]*NewsletterBuilder[^\n]*from ['"]\.\.\/\.\.\/components\/NewsletterBuilder['"]/m,
    message: 'NewsletterDesignStudio.tsx must lazy-load the GrapesJS newsletter builder after the studio shell/data load.',
  },
  {
    file: 'src/admin/modules/newsletters/NewsletterDesignStudio.tsx',
    pattern: /from ['"]@\/components\/ui['"]/,
    message: 'NewsletterDesignStudio.tsx must import only the UI primitives it renders, not the full shared UI barrel.',
  },
  {
    file: 'src/super-admin/SuperAdminApp.tsx',
    pattern: /useTranslation\([^)]*['"]admin['"]/,
    message: 'SuperAdminApp.tsx must not preload the monolithic admin locale namespace.',
  },
  {
    file: 'src/broker/BrokerApp.tsx',
    pattern: /useTranslation\([^)]*['"]admin['"]|from ['"]@\/components\/feedback['"]/,
    message: 'BrokerApp.tsx must not preload the monolithic admin namespace or use the feedback barrel on panel startup.',
  },
  {
    file: 'src/partners/PartnersApp.tsx',
    pattern: /useTranslation\([^)]*['"]admin['"]|useTranslation\([^)]*['"]caring_community['"]|from ['"]@\/components\/feedback['"]/,
    message: 'PartnersApp.tsx must not preload admin/caring namespaces or use the feedback barrel on panel startup.',
  },
];

const criticalPublicImportDirs = [
  'src/pages/public',
  'src/pages/about',
  'src/pages/help',
  'src/components/legal',
  'src/pages/listings',
  'src/pages/blog',
  'src/pages/explore',
  'src/pages/marketplace',
  'src/components/marketplace',
  'src/pages/activity',
  'src/pages/feed',
  'src/pages/group-exchanges',
  'src/pages/matches',
  'src/pages/skills',
  'src/pages/volunteering',
  'src/components/endorsements',
  'src/components/feed',
  'src/components/hashtags',
  'src/pages/bookmarks',
  'src/pages/federation',
  'src/pages/kb',
  'src/pages/onboarding',
  'src/pages/resources',
  'src/pages/advertise',
  'src/pages/caring-community',
  'src/pages/clubs',
  'src/pages/ideation',
  'src/pages/organisations',
  'src/pages/settings',
  'src/pages/jobs',
  'src/components/jobs',
  'src/pages/goals',
  'src/pages/polls',
  'src/pages/groups',
  'src/components/ideation',
  'src/pages/errors',
  'src/pages/exchanges',
  'src/pages/leaderboard',
  'src/pages/achievements',
  'src/pages/nexus-score',
  'src/components/landing',
  'src/pages/dashboard',
  'src/components/listings',
  'src/pages/messages',
  'src/components/wallet',
  'src/pages/wallet',
  'src/components/profile',
  'src/pages/profile',
  'src/components/availability',
  'src/components/search',
  'src/components/location',
  'src/components/layout',
  'src/components/branding',
  'src/components/navigation',
  'src/pages/search',
  'src/pages/notifications',
  'src/pages/members',
  'src/pages/events',
];

const authStartupImportDirs = [
  'src/pages/auth',
  'src/components/auth',
];

const newsletterAdminLocaleFiles = [
  'src/admin/components/NewsletterBuilder.tsx',
  'src/admin/components/NewsletterContentEditor.tsx',
  'src/admin/components/NewsletterPreviewPane.tsx',
  'src/admin/components/PlainTextEditor.tsx',
  'src/admin/components/TemplateGalleryModal.tsx',
];

const moduleAdminNamespaceBudgets = [
  {
    dir: 'src/admin/modules/newsletters',
    namespace: 'admin_newsletters',
    message: 'newsletter admin surfaces must use the smaller admin_newsletters namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/advanced',
    namespace: 'admin_advanced',
    message: 'advanced admin surfaces must use the smaller admin_advanced namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/config',
    namespace: 'admin_config',
    message: 'configuration admin surfaces must use the smaller admin_config namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/system',
    namespace: 'admin_system',
    message: 'system admin surfaces must use the smaller admin_system namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/federation',
    namespace: 'admin_federation',
    message: 'federation admin surfaces must use the smaller admin_federation namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/enterprise',
    namespace: 'admin_enterprise',
    message: 'enterprise admin surfaces must use the smaller admin_enterprise namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/super',
    namespace: 'admin_super',
    message: 'super admin surfaces must use the smaller admin_super namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/volunteering',
    namespace: 'admin_volunteering',
    message: 'volunteering admin surfaces must use the smaller admin_volunteering namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/timebanking',
    namespace: 'admin_timebanking',
    message: 'timebanking admin surfaces must use the smaller admin_timebanking namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/groups',
    namespace: 'admin_groups',
    message: 'group admin surfaces must use the smaller admin_groups namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/gamification',
    namespace: 'admin_gamification',
    message: 'gamification admin surfaces must use the smaller admin_gamification namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/reports',
    namespace: 'admin_reports',
    message: 'report admin surfaces must use the smaller admin_reports namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/billing',
    namespace: 'admin_billing',
    message: 'billing admin surfaces must use the smaller admin_billing namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/analytics',
    namespace: 'admin_analytics',
    message: 'analytics admin surfaces must use the smaller admin_analytics namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/matching',
    namespace: 'admin_matching',
    message: 'matching admin surfaces must use the smaller admin_matching namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/moderation',
    namespace: 'admin_moderation',
    message: 'moderation admin surfaces must use the smaller admin_moderation namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/crm',
    namespace: 'admin_crm',
    message: 'CRM admin surfaces must use the smaller admin_crm namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/ai',
    namespace: 'admin_ai',
    message: 'AI admin surfaces must use the smaller admin_ai namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/marketplace',
    namespace: 'admin_marketplace',
    message: 'marketplace admin surfaces must use the smaller admin_marketplace namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/content',
    namespace: 'admin_content',
    message: 'content admin surfaces must use the smaller admin_content namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/resources',
    namespace: 'admin_resources',
    message: 'resource admin surfaces must use the smaller admin_resources namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/blog',
    namespace: 'admin_blog',
    message: 'blog admin surfaces must use the smaller admin_blog namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/jobs',
    namespace: 'admin_jobs',
    message: 'jobs admin surfaces must use the smaller admin_jobs namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/users',
    namespace: 'admin_users',
    message: 'user admin surfaces must use the smaller admin_users namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/listings',
    namespace: 'admin_listings',
    message: 'listing admin surfaces must use the smaller admin_listings namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/caring-community',
    namespace: 'admin_caring_community',
    message: 'caring-community admin surfaces must use the smaller admin_caring_community namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/advertising',
    namespace: 'admin_advertising',
    message: 'advertising admin surfaces must use the smaller admin_advertising namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/agents',
    namespace: 'admin_agents',
    message: 'agent admin surfaces must use the smaller admin_agents namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/api-partners',
    namespace: 'admin_api_partners',
    message: 'API partner admin surfaces must use the smaller admin_api_partners namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/categories',
    namespace: 'admin_categories',
    message: 'category admin surfaces must use the smaller admin_categories namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/community',
    namespace: 'admin_community',
    message: 'community admin surfaces must use the smaller admin_community namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/deliverability',
    namespace: 'admin_deliverability',
    message: 'deliverability admin surfaces must use the smaller admin_deliverability namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/diagnostics',
    namespace: 'admin_diagnostics',
    message: 'diagnostics admin surfaces must use the smaller admin_diagnostics namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/events',
    namespace: 'admin_events',
    message: 'event admin surfaces must use the smaller admin_events namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/goals',
    namespace: 'admin_goals',
    message: 'goal admin surfaces must use the smaller admin_goals namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/help',
    namespace: 'admin_help_module',
    message: 'help admin surfaces must use the smaller admin_help_module namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/ideation',
    namespace: 'admin_ideation',
    message: 'ideation admin surfaces must use the smaller admin_ideation namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/impact',
    namespace: 'admin_impact',
    message: 'impact admin surfaces must use the smaller admin_impact namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/legal',
    namespace: 'admin_legal',
    message: 'legal admin surfaces must use the smaller admin_legal namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/national',
    namespace: 'admin_national',
    message: 'national admin surfaces must use the smaller admin_national namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/performance',
    namespace: 'admin_performance',
    message: 'performance admin surfaces must use the smaller admin_performance namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/podcasts',
    namespace: 'admin_podcasts',
    message: 'podcast admin surfaces must use the smaller admin_podcasts namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/polls',
    namespace: 'admin_polls',
    message: 'poll admin surfaces must use the smaller admin_polls namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/premium',
    namespace: 'admin_premium',
    message: 'premium admin surfaces must use the smaller admin_premium namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/provisioning',
    namespace: 'admin_provisioning',
    message: 'provisioning admin surfaces must use the smaller admin_provisioning namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/regional-analytics',
    namespace: 'admin_regional_analytics',
    message: 'regional analytics admin surfaces must use the smaller admin_regional_analytics namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/safeguarding',
    namespace: 'admin_safeguarding',
    message: 'safeguarding admin surfaces must use the smaller admin_safeguarding namespace instead of loading admin.json.',
  },
  {
    dir: 'src/admin/modules/support',
    namespace: 'admin_support',
    message: 'support admin surfaces must use the smaller admin_support namespace instead of loading admin.json.',
  },
];

const requiredSplitAdminNamespaces = [
  ...new Set([
    ...moduleAdminNamespaceBudgets.map((budget) => budget.namespace),
    'admin_editor',
    'admin_legal_editor',
    'admin_not_found_module',
  ]),
];

const heavyStaticAssetBudgets = [
  {
    file: 'src/pages/about/PartnerPage.tsx',
    pattern: /\/images\/(?:Timebanking-UK-and-Timebank-Ireland-Partners\.png|project-nexus-logo\.png|timebank_ireland_west_cork_partnership\.jpg)/,
    message: 'PartnerPage must use the existing WebP partner/logo artwork instead of pointing at the multi-hundred-KB PNG/JPG originals.',
  },
];

const responsiveUploadedMediaBudgets = [
  {
    file: 'src/pages/listings/ListingsPage.tsx',
    pattern: /^(?![\s\S]*responsiveThumbnailProps)/,
    message: 'ListingsPage listing images must use responsiveThumbnailProps so browsers do not download one oversized image for every card.',
  },
  {
    file: 'src/pages/listings/ListingDetailPage.tsx',
    pattern: /^(?![\s\S]*responsiveThumbnailProps)/,
    message: 'ListingDetailPage hero media must use responsiveThumbnailProps for uploaded listing images.',
  },
  {
    file: 'src/components/marketplace/MarketplaceListingCard.tsx',
    pattern: /^(?![\s\S]*responsiveThumbnailProps)/,
    message: 'MarketplaceListingCard images must use responsiveThumbnailProps for card-sized uploaded media.',
  },
  {
    file: 'src/components/marketplace/MarketplaceImageGallery.tsx',
    pattern: /^(?![\s\S]*responsiveThumbnailProps)/,
    message: 'MarketplaceImageGallery must use responsiveThumbnailProps for gallery images.',
  },
  {
    file: 'src/components/feed/MediaGrid.tsx',
    pattern: /^(?![\s\S]*responsiveThumbnailProps)/,
    message: 'Feed MediaGrid image cells must use responsiveThumbnailProps for uploaded feed media.',
  },
  {
    file: 'src/components/feed/ImageCarousel.tsx',
    pattern: /^(?![\s\S]*responsiveThumbnailProps)/,
    message: 'Feed ImageCarousel display images must use responsiveThumbnailProps for uploaded feed media.',
  },
  {
    file: 'src/pages/search/SearchPage.tsx',
    pattern: /^(?![\s\S]*responsiveThumbnailProps)/,
    message: 'Search listing result images must use responsiveThumbnailProps.',
  },
];

// Header/footer brand marks are an explicit exception to the usual "prefer WebP"
// image rule: they must be allowed to use transparent raster logo files so
// light/dark logo contrast is faithful. Keep page-level guards above so ordinary
// content pages do not point at the heavy originals.
const disallowedPublicAssets = [];

const migratedAdminMonolithGroups = [
  'advanced',
  'email_deliverability',
  'federation',
  'federation_admin_guidance',
  'config',
  'tenant_features',
  'system',
  'admin_settings',
  'operations',
  'retention',
  'seed_generator',
  'sso',
  'verification',
  'enterprise',
  'legal_doc_form',
  'legal_versions',
  'log_files_labels',
  'super',
  'tenant_form',
  'federation_whitelist',
  'pilot_inquiry_admin',
  'volunteering',
  'donation_refunds',
  'newsletters',
  'newsletter_form',
  'newsletter_builder',
  'newsletter_content_editor',
  'newsletter_activity',
  'newsletter_bounces',
  'newsletter_templates',
  'newsletter_segments',
  'newsletter_diagnostics',
  'newsletter_resend',
  'newsletter_send_time',
  'segment_form',
  'template_form',
  'timebanking',
  'groups',
  'group_organization',
  'gamification',
  'reports',
  'municipal_reports',
  'billing',
  'analytics',
  'search_analytics',
  'matching',
  'moderation',
  'crm',
  'ai',
  'marketplace',
  'bulk',
  'jobs',
  'users',
  'user_edit',
  'resources',
  'blog',
  'data_table',
  'breadcrumbs',
  'cancel',
  'menu_builder',
  'no_data',
  'listings',
  'caring_community',
  'caring_emergency',
  'caring_workflow',
  'category_coefficients',
  'commercial_boundary',
  'data_quality',
  'disclosure_pack',
  'external_integrations',
  'federation_peers_admin',
  'help_request_sla',
  'integration_showcase',
  'isolated_node',
  'kpi_baselines',
  'lead_nurture',
  'municipal_copilot',
  'municipal_roi_page',
  'municipal_verification',
  'pilot_launch_readiness',
  'pilot_scoreboard',
  'research_partnerships',
  'smart_nudges',
  'sub_regions',
  'success_stories_admin',
  'advertising',
  'agents',
  'api_partners',
  'categories',
  'community',
  'deliverability',
  'diagnostics',
  'diagnostics_matching',
  'events',
  'goals',
  'admin_help',
  'help_faqs',
  'ideation',
  'impact',
  'impact_report_labels',
  'fadp',
  'national',
  'national_kiss_dashboard',
  'performance',
  'podcasts_admin',
  'polls',
  'member_premium_admin',
  'provisioning_requests',
  'regional_analytics_admin',
  'safeguarding',
  'support_reports',
  'admin_not_found',
  'page_builder',
  'rte',
  'content',
  'broker',
];

const allowedHeroUiRootImportFiles = new Set([
  'src/components/ui/useDisclosure.ts',
  // App.tsx imports I18nProvider, which HeroUI v3 publishes ONLY from the root
  // barrel — checked against @heroui/react's own exports map on 2026-08-28: 88
  // subpaths, none for I18nProvider or the providers generally. So there is no
  // focused import to prefer here. It is also the cheapest possible place for a
  // root import: App.tsx is the app shell, already in the startup graph on every
  // route, so unlike a lazy route chunk it pulls nothing extra in. Re-check when
  // HeroUI adds a provider subpath.
  'src/App.tsx',
]);

async function sourceFilesIn(relativeDir) {
  const dir = path.resolve(import.meta.dirname, '..', relativeDir);
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await sourceFilesIn(relativePath));
      continue;
    }

    if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.(test|spec)\.(tsx?|jsx?)$/.test(entry.name)) {
      files.push(relativePath);
    }
  }

  return files;
}

async function htmlFilesInDist(relativeDir = '') {
  const dir = path.join(distRoot, relativeDir);
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await htmlFilesInDist(relativePath));
      continue;
    }

    if (entry.name.endsWith('.html')) {
      files.push(path.join(distRoot, relativePath));
    }
  }

  return files;
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

async function gzipSize(filePath) {
  const contents = await readFile(filePath);
  return gzipSync(contents).byteLength;
}

async function distAssetNames() {
  return (await readdir(distDir)).filter((entry) => entry.endsWith('.js'));
}

async function staticJsDependencyGraph(entryAsset) {
  const seen = new Set();
  const queue = [entryAsset];

  while (queue.length > 0) {
    const asset = queue.shift();
    if (!asset || seen.has(asset)) continue;
    seen.add(asset);

    const source = await readFile(path.join(distDir, asset), 'utf8');
    for (const match of source.matchAll(/from\s*["']\.\/([^"']+\.js)["']/g)) {
      if (!seen.has(match[1])) {
        queue.push(match[1]);
      }
    }
  }

  return seen;
}

async function staticRouteGraphGzip(prefix) {
  const entry = (await distAssetNames()).find((asset) => asset.startsWith(`${prefix}-`));
  if (!entry) {
    throw new Error(`Could not find ${prefix} route chunk in dist/assets.`);
  }

  const graph = await staticJsDependencyGraph(entry);
  let bytes = 0;
  for (const asset of graph) {
    bytes += await gzipSize(path.join(distDir, asset));
  }

  return { entry, bytes, count: graph.size, graph };
}

async function serviceWorkerPrecacheSize() {
  const source = await readFile(serviceWorkerPath, 'utf8');
  const precacheStart = source.indexOf('precacheAndRoute(');
  if (precacheStart === -1) {
    throw new Error('Could not find the generated Workbox precache manifest in dist/sw.js.');
  }

  const manifestStart = source.indexOf('[', precacheStart);
  const manifestEnd = source.indexOf(']', manifestStart);
  if (manifestStart === -1 || manifestEnd === -1) {
    throw new Error('Could not read the generated Workbox precache manifest in dist/sw.js.');
  }

  const manifestSource = source.slice(manifestStart, manifestEnd + 1);
  const urls = new Set();
  for (const match of manifestSource.matchAll(/(?:^|[,{])\s*(?:url|["']url["'])\s*:\s*["']([^"']+)["']/g)) {
    urls.add(match[1]);
  }

  if (urls.size === 0) {
    throw new Error('The generated Workbox precache manifest in dist/sw.js did not contain any local URLs.');
  }

  let bytes = 0;
  const entries = [];

  for (const url of urls) {
    if (/^https?:\/\//.test(url)) continue;
    const file = path.resolve(distRoot, url.replace(/^\//, ''));
    try {
      const fileStat = await stat(file);
      bytes += fileStat.size;
      entries.push({ url, bytes: fileStat.size });
    } catch {
      // Workbox validates generated entries at build time. This guard only
      // budgets local files that are present in dist.
    }
  }

  return { bytes, entries };
}

async function main() {
  const html = await readFile(indexHtmlPath, 'utf8');
  const mainJs = html.match(/<script[^>]+type="module"[^>]+src="\/assets\/([^"]+\.js)"/)?.[1];
  const mainCss = html.match(/<link[^>]+rel="stylesheet"[^>]+href="\/assets\/([^"]+\.css)"/)?.[1];
  const modulePreloads = [
    ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+\.js)"/g),
  ].map((match) => match[1]);
  const failures = [];

  for (const preload of modulePreloads) {
    for (const disallowed of disallowedShellPreloads) {
      if (disallowed.pattern.test(preload)) {
        failures.push(`${preload}: ${disallowed.message}`);
      }
    }
  }

  for (const htmlFile of await htmlFilesInDist()) {
    const relativeHtml = path.relative(distRoot, htmlFile).replaceAll(path.sep, '/');
    const source = await readFile(htmlFile, 'utf8');
    for (const match of source.matchAll(/<link\b[^>]*rel=["'][^"']*\bmodulepreload\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi)) {
      const href = match[1];
      if (!/^\/assets\/vendor-(?:react|i18n)-[^/]+\.js$/i.test(href)) {
        failures.push(`${relativeHtml}: prerendered HTML must not modulepreload ${href}; route chunks should hydrate through the normal import graph.`);
      }
    }
  }

  if (!mainJs) {
    failures.push('Could not find the module entry script in dist/index.html.');
  } else {
    const size = await gzipSize(path.join(distDir, mainJs));
    if (size > budgets.mainJsGzipBytes) {
      failures.push(`${mainJs} gzip size ${formatKiB(size)} exceeds ${formatKiB(budgets.mainJsGzipBytes)}.`);
    }
  }

  if (!mainCss) {
    failures.push('Could not find the stylesheet entry in dist/index.html.');
  } else {
    const size = await gzipSize(path.join(distDir, mainCss));
    if (size > budgets.mainCssGzipBytes) {
      failures.push(`${mainCss} gzip size ${formatKiB(size)} exceeds ${formatKiB(budgets.mainCssGzipBytes)}.`);
    }
  }

  for (const routePrefix of ['LoginPage', 'RegisterPage']) {
    const routeGraph = await staticRouteGraphGzip(routePrefix);
    if (routeGraph.bytes > budgets.authRouteStaticJsGzipBytes) {
      failures.push(`${routeGraph.entry} static JS graph gzip size ${formatKiB(routeGraph.bytes)} across ${routeGraph.count} files exceeds ${formatKiB(budgets.authRouteStaticJsGzipBytes)}; auth pages must not pull the old all-HeroUI vendor chunk back into first render.`);
    }
  }

  for (const routePrefix of ['HomePage', 'LoginPage', 'RegisterPage', 'DashboardPage']) {
    const routeGraph = await staticRouteGraphGzip(routePrefix);
    const leakedEditors = [...routeGraph.graph]
      .filter((asset) => forbiddenOrdinaryRouteEditorAsset.test(asset));
    if (leakedEditors.length > 0) {
      failures.push(`${routeGraph.entry} ordinary-route graph includes editor-only assets: ${leakedEditors.join(', ')}.`);
    }
  }

  const precache = await serviceWorkerPrecacheSize();
  const precacheUrls = new Set(precache.entries.map((entry) => entry.url.replace(/^\//, '')));
  const requiredOfflineStartupAssets = [mainJs, mainCss, ...modulePreloads]
    .filter(Boolean)
    .map((asset) => `assets/${asset}`);
  requiredOfflineStartupAssets.unshift('index.html');

  for (const asset of requiredOfflineStartupAssets) {
    if (!precacheUrls.has(asset)) {
      failures.push(`service worker precache is missing startup asset ${asset}; a clean PWA install cannot restart offline.`);
    }
  }

  if (precache.bytes > budgets.serviceWorkerPrecacheBytes) {
    const largest = precache.entries
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8)
      .map((entry) => `${entry.url} ${formatKiB(entry.bytes)}`)
      .join(', ');
    failures.push(`service worker precache ${formatKiB(precache.bytes)} exceeds ${formatKiB(budgets.serviceWorkerPrecacheBytes)}. Largest entries: ${largest}.`);
  }

  for (const budget of startupImportBudgets) {
    const source = await readFile(path.resolve(import.meta.dirname, '..', budget.file), 'utf8');
    if (budget.pattern.test(source)) {
      failures.push(`${budget.file}: ${budget.message}`);
    }
  }

  {
    const mainSource = await readFile(path.resolve(import.meta.dirname, '..', 'src/main.tsx'), 'utf8');
    if (
      /navigator\.serviceWorker\.register\(['"]\/sw\.js['"]/.test(mainSource) &&
      !/runAfterFirstPaintIdle\(\s*registerServiceWorker\s*\)/.test(mainSource)
    ) {
      failures.push('src/main.tsx: production service-worker registration must wait until after first paint/idle so /sw.js does not compete with auth startup.');
    }
  }

  for (const budget of heavyStaticAssetBudgets) {
    const source = await readFile(path.resolve(import.meta.dirname, '..', budget.file), 'utf8');
    if (budget.pattern.test(source)) {
      failures.push(`${budget.file}: ${budget.message}`);
    }
  }

  for (const budget of responsiveUploadedMediaBudgets) {
    const source = await readFile(path.resolve(import.meta.dirname, '..', budget.file), 'utf8');
    if (budget.pattern.test(source)) {
      failures.push(`${budget.file}: ${budget.message}`);
    }
  }

  for (const asset of disallowedPublicAssets) {
    try {
      await access(path.resolve(import.meta.dirname, '..', asset.file));
      failures.push(`${asset.file}: ${asset.message}`);
    } catch {
      // Expected: the heavyweight original is not present in public/.
    }
  }

  for (const dir of criticalPublicImportDirs) {
    for (const file of await sourceFilesIn(dir)) {
      const source = await readFile(path.resolve(import.meta.dirname, '..', file), 'utf8');
      if (/from ['"]@\/components\/ui['"]/.test(source)) {
        failures.push(`${file}: performance-critical route surfaces must import UI pieces directly instead of through @/components/ui.`);
      }
    }
  }

  for (const dir of authStartupImportDirs) {
    for (const file of await sourceFilesIn(dir)) {
      const source = await readFile(path.resolve(import.meta.dirname, '..', file), 'utf8');
      if (/from ['"]@\/contexts['"]/.test(source)) {
        failures.push(`${file}: auth startup surfaces must import context hooks from direct modules instead of the @/contexts barrel.`);
      }
      if (/from ['"]@\/hooks['"]/.test(source)) {
        failures.push(`${file}: auth startup surfaces must import hooks from direct modules instead of the @/hooks barrel, which re-exports app-only social hooks.`);
      }
      if (/from ['"]@\/components\/seo['"]/.test(source)) {
        failures.push(`${file}: auth startup surfaces must import PageMeta directly instead of the @/components/seo barrel, which also exports app-shell SEO code.`);
      }
    }
  }

  for (const budget of moduleAdminNamespaceBudgets) {
    for (const file of await sourceFilesIn(budget.dir)) {
      const source = await readFile(path.resolve(import.meta.dirname, '..', file), 'utf8');
      if (/useTranslation\([^)]*['"]admin['"]/.test(source)) {
        failures.push(`${file}: ${budget.message}`);
      }
    }
  }

  for (const file of newsletterAdminLocaleFiles) {
    const source = await readFile(path.resolve(import.meta.dirname, '..', file), 'utf8');
    if (/useTranslation\([^)]*['"]admin['"]/.test(source)) {
      failures.push(`${file}: newsletter-specific editor components must use admin_newsletters instead of loading admin.json.`);
    }
  }

  for (const locale of ['ar', 'de', 'en', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt']) {
    for (const namespace of requiredSplitAdminNamespaces) {
      try {
        await readFile(path.resolve(import.meta.dirname, '..', 'public', 'locales', locale, `${namespace}.json`), 'utf8');
      } catch {
        failures.push(`public/locales/${locale}/${namespace}.json: missing split admin locale namespace.`);
      }
    }

    const adminLocaleSource = await readFile(path.resolve(import.meta.dirname, '..', 'public', 'locales', locale, 'admin.json'), 'utf8');
    if (Buffer.byteLength(adminLocaleSource) > budgets.adminLocaleJsonBytes) {
      failures.push(`public/locales/${locale}/admin.json: compatibility admin namespace is ${formatKiB(Buffer.byteLength(adminLocaleSource))}; keep it below ${formatKiB(budgets.adminLocaleJsonBytes)} so routes cannot regress to the old monolith.`);
    }

    const adminLocale = JSON.parse(adminLocaleSource);
    for (const group of migratedAdminMonolithGroups) {
      if (Object.prototype.hasOwnProperty.call(adminLocale, group)) {
        failures.push(`public/locales/${locale}/admin.json: migrated admin group "${group}" must live only in its split namespace.`);
      }
    }
  }

  for (const file of await sourceFilesIn('src')) {
    const source = await readFile(path.resolve(import.meta.dirname, '..', file), 'utf8');
    if (!allowedHeroUiRootImportFiles.has(file) && /from ['"]@heroui\/react['"]/.test(source)) {
      failures.push(`${file}: import HeroUI components from focused @heroui/react/* subpaths instead of the root barrel so route chunks do not pull unused primitives.`);
    }
    if (file !== 'src/components/location/index.ts' && /from ['"]@\/components\/location['"]/.test(source)) {
      failures.push(`${file}: import map and autocomplete components directly so the location barrel cannot couple Google Maps into unrelated route chunks.`);
    }
    if (
      file !== 'src/components/location/LocationMap.tsx' &&
      /^import\s+(?!type\b)[^\n]*\bLocationMap\b[^\n]*from ['"][^'"]*\/LocationMap['"]/m.test(source)
    ) {
      failures.push(`${file}: lazy-load LocationMap so Google/OpenStreetMap code only downloads when a map is actually rendered.`);
    }
    if (file !== 'src/lib/sentry.ts' && /from ['"]@\/lib\/sentry['"]/.test(source)) {
      failures.push(`${file}: import the Sentry wrapper lazily so telemetry cannot re-enter startup chunks.`);
    }
    if (file !== 'src/lib/sentry.ts' && /from ['"]@sentry\/react['"]/.test(source)) {
      failures.push(`${file}: do not import @sentry/react directly; route telemetry through the lazy Sentry wrapper.`);
    }
    if (/useTranslation\([^)]*['"]admin['"]/.test(source) || /useTranslation\(\s*\[\s*['"]admin['"]/.test(source)) {
      failures.push(`${file}: production source must use split admin namespaces instead of loading admin.json.`);
    }
  }

  if (failures.length > 0) {
    console.error('[bundle-budget] failed');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('[bundle-budget] passed');
}

main().catch((error) => {
  console.error('[bundle-budget] failed to inspect dist assets');
  console.error(error);
  process.exit(1);
});
