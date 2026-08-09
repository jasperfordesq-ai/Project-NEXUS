// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

require('dotenv').config();

const express = require('express');
const nunjucks = require('nunjucks');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const flash = require('express-flash');
const helmet = require('helmet');
const morgan = require('morgan');
const { doubleCsrf } = require('csrf-csrf');
const path = require('path');
const { URL } = require('url');
const { getApiBaseUrl } = require('./lib/backend-contract');

const authRoutes = require('./routes/auth');
const listingsRoutes = require('./routes/listings');
const profileRoutes = require('./routes/profile');
const activityRoutes = require('./routes/activity');
const walletRoutes = require('./routes/wallet');
const messagesRoutes = require('./routes/messages');
const dashboardRoutes = require('./routes/dashboard');
const settingsRoutes = require('./routes/settings');
const connectionsRoutes = require('./routes/connections');
const membersRoutes = require('./routes/members');
const notificationsRoutes = require('./routes/notifications');
const groupsRoutes = require('./routes/groups');
const jobsRoutes = require('./routes/jobs');
const goalsRoutes = require('./routes/goals');
const coursesRoutes = require('./routes/courses');
const eventsRoutes = require('./routes/events');
const eventTemplateRoutes = require('./routes/event-templates');
const feedRoutes = require('./routes/feed');
const feedActionRoutes = require('./routes/feed-actions');
const marketplaceActionRoutes = require('./routes/marketplace-actions');
const marketplaceRoutes = require('./routes/marketplace');
const volunteeringActionRoutes = require('./routes/volunteering-actions');
const ideationRoutes = require('./routes/ideation');
const ideationActionRoutes = require('./routes/ideation-actions');
const groupExchangeRoutes = require('./routes/group-exchanges');
const groupExchangeActionRoutes = require('./routes/group-exchange-actions');
const matchesRoutes = require('./routes/matches');
const exchangeRoutes = require('./routes/exchanges');
const searchRoutes = require('./routes/search');
const reviewsRoutes = require('./routes/reviews');
const exploreRoutes = require('./routes/explore');
const staticPageRoutes = require('./routes/static-pages');
const kbRoutes = require('./routes/kb');
const supportRoutes = require('./routes/support');
const legalRoutes = require('./routes/legal');
const publicInfoRoutes = require('./routes/public-info');
const contactSupportRoutes = require('./routes/contact-support');
const onboardingPostRoutes = require('./routes/onboarding-posts');
const savedCollectionRoutes = require('./routes/saved-collections');
const savedSocialRoutes = require('./routes/saved-social');
const aiChatRoutes = require('./routes/ai-chat');
const skillsRoutes = require('./routes/skills');
const premiumRoutes = require('./routes/premium');
const couponsRoutes = require('./routes/coupons');
const achievementsRoutes = require('./routes/achievements');
const leaderboardRoutes = require('./routes/leaderboard');
const nexusScoreRoutes = require('./routes/nexus-score');
const resourcesRoutes = require('./routes/resources');
const blogPostRoutes = require('./routes/blog-posts');
const pollActionRoutes = require('./routes/poll-actions');
const clubsRoutes = require('./routes/clubs');
const podcastRoutes = require('./routes/podcasts');
const podcastActionRoutes = require('./routes/podcast-actions');
const federationRoutes = require('./routes/federation');
const federationActionRoutes = require('./routes/federation-actions');
const laravelPrepRoutes = require('./routes/laravel-prep-pages');
const { errorLogger, finalErrorHandler } = require('./lib/errorHandler');
const { ApiError, getExchangeConfig } = require('./lib/api');
const { generalLimiter, authLimiter, walletLimiter, formLimiter } = require('./lib/rateLimiter');
const { handleApiError } = require('./lib/routeHelpers');
const { buildShellLocals, resolveBackendAssetUrl } = require('./lib/accessible-shell');
const { formatLocaleDate, localeForIntl, translate, translateChoice } = require('./lib/localization');
const { getRequestLocale } = require('./lib/request-locale-context');
const { parseMultipartForm } = require('./middleware/multipart');
const { buildAccountLinks } = require('./lib/account-links');
const { localization } = require('./middleware/localization');
const { tenantFeatureGate } = require('./middleware/tenant-feature-gates');
const { tenantRouting } = require('./middleware/tenant-routing');
const { requestTenantContext } = require('./middleware/request-tenant-context');
const { refreshAuthSession, requireAuth } = require('./middleware/auth');
const { assertProductionConfig } = require('./lib/production-config');
const { createSessionStore } = require('./lib/session-store');

const app = express();

const PORT = process.env.PORT || 3001;
const COOKIE_SECRET = process.env.COOKIE_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || COOKIE_SECRET;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ACCESSIBLE_COOKIE_NAME = 'nexus_accessible_cookie_consent';
const LEGACY_ALPHA_COOKIE_NAME = 'nexus_alpha_cookie_consent';
const ALPHA_COOKIE_MAX_AGE = 180 * 24 * 60 * 60 * 1000;
assertProductionConfig(process.env);
const sessionStore = createSessionStore({ nodeEnv: NODE_ENV });

const HOME_MODULES = [
  { key: 'dashboard', titleKey: 'dashboard.title', descriptionKey: 'dashboard.description', href: '/dashboard', authRequired: true },
  { key: 'feed', titleKey: 'feed.title', descriptionKey: 'feed.description', href: '/feed', moduleKey: 'feed', defaultEnabled: true },
  { key: 'listings', titleKey: 'listings.title', descriptionKey: 'listings.description', href: '/listings', moduleKey: 'listings', defaultEnabled: false },
  { key: 'members', titleKey: 'members.title', descriptionKey: 'members.description', href: '/members', featureKey: 'connections' },
  { key: 'events', titleKey: 'events.title', descriptionKey: 'events.description', href: '/events', featureKey: 'events' },
  { key: 'volunteering', titleKey: 'volunteering.title', descriptionKey: 'volunteering.description', href: '/volunteering', featureKey: 'volunteering' },
  { key: 'messages', titleKey: 'messages.title', descriptionKey: 'messages.description', href: '/messages', authRequired: true, featureKey: 'direct_messaging' },
  { key: 'exchanges', titleKey: 'exchanges.title', descriptionKey: 'exchanges.description', href: '/exchanges', authRequired: true, moduleKey: 'listings', featureKey: 'exchange_workflow', defaultEnabled: false },
  { key: 'wallet', titleKey: 'wallet.title', descriptionKey: 'wallet.description', href: '/wallet', authRequired: true, moduleKey: 'wallet' },
  { key: 'profile', titleKey: 'nav.profile', descriptionKey: 'profile_settings.description', href: '/profile', authRequired: true }
];

if (!COOKIE_SECRET) {
  console.error('COOKIE_SECRET environment variable is required');
  process.exit(1);
}

// Configure Nunjucks
const nunjucksEnv = nunjucks.configure([
  path.join(__dirname, 'views'),
  path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')
], {
  autoescape: true,
  express: app,
  watch: NODE_ENV === 'development'
});

// Custom Nunjucks filters
nunjucksEnv.addFilter('parseJson', (str) => {
  if (!str) return {};
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
});

nunjucksEnv.addFilter('formatDate', (dateStr) => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    const locale = getRequestLocale() || 'en';
    if (diffMins < 1) return translate(locale, 'govuk_alpha_connections.common.just_now');
    if (diffMins < 60) {
      return translateChoice(locale, 'govuk_alpha_connections.common.minutes_ago', diffMins, { count: diffMins });
    }
    if (diffHours < 24) {
      return translateChoice(locale, 'govuk_alpha_connections.common.hours_ago', diffHours, { count: diffHours });
    }
    if (diffDays < 7) {
      return translateChoice(locale, 'govuk_alpha_connections.common.days_ago', diffDays, { count: diffDays });
    }

    return formatLocaleDate(date, locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return dateStr;
  }
});

nunjucksEnv.addFilter('formatBladeDateTime', (dateStr) => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const locale = getRequestLocale() || 'en';
    const parts = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).formatToParts(date);
    const value = (type) => parts.find((part) => part.type === type)?.value || '';
    const dayPeriod = value('dayPeriod').replace(/\s+/g, '').toLocaleLowerCase(locale);
    return `${value('day')} ${value('month')} ${value('year')}, ${value('hour')}:${value('minute')}${dayPeriod}`;
  } catch {
    return dateStr;
  }
});

nunjucksEnv.addFilter('formatEventDate', (dateStr) => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return formatLocaleDate(date, getRequestLocale() || 'en', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
});

// Alias 'date' to formatDate for convenience
nunjucksEnv.addFilter('date', (dateStr) => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return formatLocaleDate(date, getRequestLocale() || 'en', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return dateStr;
  }
});

nunjucksEnv.addFilter('abs', (num) => Math.abs(num || 0));

nunjucksEnv.addFilter('take', (arr, count) => {
  if (!arr || !Array.isArray(arr)) return [];
  return arr.slice(0, count);
});

nunjucksEnv.addFilter('nl2br', (str) => {
  if (!str) return '';
  // Escape HTML entities first to prevent XSS, then convert newlines to <br>
  const escaped = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  return escaped.replace(/\n/g, '<br>');
});

app.set('view engine', 'njk');

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

app.use(tenantRouting);
app.use(requestTenantContext);

// Security headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // GOV.UK Frontend requires an inline script to detect JS support
      // Hash is for: document.body.className += ' js-enabled' + ('noModule' in HTMLScriptElement.prototype ? ' govuk-frontend-supported' : '');
      // challenges.cloudflare.com — Cloudflare Turnstile widget script.
      scriptSrc: ["'self'", "'sha256-GUQ5ad8JK5KmEWmROf3LZd9ge94daqNvd8xy9YS1iDw='", "https://challenges.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", new URL(getApiBaseUrl()).origin],
      fontSrc: ["'self'"],
      // challenges.cloudflare.com — Turnstile siteverify (server-side) +
      // browser-side widget telemetry posts back to its own origin.
      // api.pwnedpasswords.com — client-side HIBP k-anonymity check on the
      // register / reset-password forms.
      connectSrc: ["'self'", "https://challenges.cloudflare.com", "https://api.pwnedpasswords.com"],
      // frameSrc: Turnstile renders an iframe to challenges.cloudflare.com
      // to host the bot challenge UI. Was 'none' — that blocked the widget.
      frameSrc: ["https://challenges.cloudflare.com"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Request logging. Broad local smoke runs can opt out so their terminal output
// remains a concise certification report instead of hundreds of access lines.
if (process.env.DISABLE_REQUEST_LOGGING !== '1') {
  if (NODE_ENV === 'production') {
    app.use(morgan('combined'));
  } else {
    app.use(morgan('dev'));
  }
}

// Static assets (before rate limiter so static file requests don't count against limits)
// Add cache headers for better performance
const staticOptions = {
  maxAge: NODE_ENV === 'production' ? '1d' : 0,
  etag: true,
  lastModified: true
};

app.use('/css', express.static(path.join(__dirname, '..', 'public', 'css'), staticOptions));
app.use('/assets', express.static(
  path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist', 'govuk', 'assets'),
  staticOptions
));
// Serve custom JS from public/js first, then fallback to govuk-frontend
app.use('/js', express.static(path.join(__dirname, '..', 'public', 'js'), staticOptions));
app.use('/js', express.static(
  path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist', 'govuk'),
  staticOptions
));

// General rate limiting (see lib/rateLimiter.js for route-specific limits)
app.use(generalLimiter);

// Body parsing
app.use(express.urlencoded({
  extended: true,
  verify: (req, _res, buffer) => {
    req.rawUrlencodedBody = buffer.toString('utf8');
  }
}));
app.use(express.json());

// Cookies
app.use(cookieParser(COOKIE_SECRET));

// Session for flash messages
app.use(session({
  secret: SESSION_SECRET,
  store: sessionStore.store,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 60 * 1000, // 30 minutes
    sameSite: 'lax'
  },
  name: 'nexus.sid'
}));

// Flash messages
app.use(flash());

// Laravel-first accessible locale negotiation. This must run after the session
// middleware so an explicit language choice can persist across requests.
app.use(localization);
app.use(refreshAuthSession);

// CSRF protection
const {
  generateToken,
  doubleCsrfProtection
} = doubleCsrf({
  getSecret: () => COOKIE_SECRET,
  cookieName: 'nexus.csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: NODE_ENV === 'production',
    signed: true
  },
  getTokenFromRequest: (req) => req.body._csrf || req.headers['x-csrf-token']
});

// Make CSRF token available to all views
app.use((req, res, next) => {
  req.csrfToken = () => generateToken(req, res);
  next();
});

// Add common variables to all views
app.use(async (req, res, next) => {
  // Check if user is authenticated
  const token = req.signedCookies.token;
  res.locals.isAuthenticated = !!token;
  Object.assign(res.locals, buildShellLocals(req, res.locals.isAuthenticated));

  const alphaCookieChoice = req.session ? req.session.alphaCookieChoice : '';
  if (alphaCookieChoice && req.session) {
    delete req.session.alphaCookieChoice;
  }

  res.locals.alphaCookieChoice = alphaCookieChoice || '';
  res.locals.alphaCookieConsent = req.cookies[ACCESSIBLE_COOKIE_NAME] || req.cookies[LEGACY_ALPHA_COOKIE_NAME] || '';
  res.locals.alphaHasCookieChoice = req.cookies[ACCESSIBLE_COOKIE_NAME] !== undefined
    || req.cookies[LEGACY_ALPHA_COOKIE_NAME] !== undefined;
  res.locals.showAlphaCookieBanner = !!alphaCookieChoice || !res.locals.alphaHasCookieChoice;

  // Make CSRF token available to all views
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';

  // Session timeout warning
  if (req.session && req.session.cookie) {
    const maxAge = req.session.cookie.maxAge;
    res.locals.sessionTimeout = maxAge ? Math.floor(maxAge / 1000 / 60) : null;
  }

  // Fetch notification and message counts for authenticated users
  if (token) {
    try {
      const { getNotificationUnreadCount, getUnreadCount } = require('./lib/api');
      const [notifResult, msgResult] = await Promise.all([
        getNotificationUnreadCount(token).catch(() => ({ unreadCount: 0 })),
        getUnreadCount(token).catch(() => ({ unreadCount: 0 }))
      ]);
      const notificationCounts = notifResult?.data || notifResult || {};
      const messageCounts = msgResult?.data || msgResult || {};
      res.locals.notificationCount = notificationCounts.unread
        || notificationCounts.total
        || notificationCounts.unreadCount
        || notificationCounts.unread_count
        || notificationCounts.count
        || 0;
      res.locals.unreadMessageCount = messageCounts.count
        || messageCounts.unreadCount
        || messageCounts.unread_count
        || 0;
    } catch {
      // Silently fail - don't break the page if counts fail
      res.locals.notificationCount = 0;
      res.locals.unreadMessageCount = 0;
    }
  }

  next();
});

app.use(tenantFeatureGate);

function normalizeTenantChooserCommunities(result) {
  const records = Array.isArray(result?.data)
    ? result.data
    : (Array.isArray(result) ? result : []);

  return records
    .filter((tenant) => tenant && tenant.id !== 1 && tenant.slug)
    .map((tenant) => {
      const slug = String(tenant.slug);
      return {
        id: tenant.id,
        name: tenant.name || slug,
        slug,
        tagline: tenant.tagline || '',
        href: `/${encodeURIComponent(slug)}/accessible`
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'en-GB'));
}

function dataFrom(result) {
  return result?.data || result?.tenant || result || {};
}

function numberLabel(value, formatNumber) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  if (typeof formatNumber === 'function') {
    return formatNumber(number, { maximumFractionDigits: 0 });
  }
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(number);
}

function inlineScriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function normalizeRequestHost(req) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const raw = String(forwardedHost || req.hostname || req.headers.host || '').trim().toLowerCase();
  if (!raw) return '';

  const withoutProtocol = raw.replace(/^https?:\/\//, '');
  const withoutPath = withoutProtocol.split('/')[0];
  const withoutPort = withoutPath.startsWith('[')
    ? withoutPath.replace(/^\[|\](?::\d+)?$/g, '')
    : withoutPath.split(':')[0];

  return withoutPort.replace(/^www\./, '');
}

function networkCommunityHref(item, req) {
  const rawUrl = String(item?.url || '').trim();
  if (!rawUrl) {
    return item?.slug ? `/${encodeURIComponent(String(item.slug))}` : '';
  }

  if (rawUrl.startsWith('/') && !rawUrl.startsWith('//')) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    const host = normalizeRequestHost(req);
    const parsedHost = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host && parsedHost === host) {
      return `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`;
    }
    return rawUrl;
  } catch {
    return item?.slug ? `/${encodeURIComponent(String(item.slug))}` : '';
  }
}

function normalizeNetworkCommunities(tenant, req) {
  const items = Array.isArray(tenant?.tenant_switcher?.items)
    ? tenant.tenant_switcher.items
    : [];

  return items
    .map((item) => ({
      name: item?.name || item?.slug || '',
      slug: item?.slug || '',
      tagline: item?.tagline || '',
      href: networkCommunityHref(item, req)
    }))
    .filter((item) => item.name && item.href);
}

function featureEnabled(tenant, key, fallback = true) {
  const features = tenant.features && typeof tenant.features === 'object' ? tenant.features : {};
  const modules = tenant.modules && typeof tenant.modules === 'object' ? tenant.modules : {};
  if (Object.prototype.hasOwnProperty.call(features, key)) return Boolean(features[key]);
  if (Object.prototype.hasOwnProperty.call(modules, key)) return Boolean(modules[key]);
  return fallback;
}

function buildHomeModules(tenant, isAuthenticated, t) {
  return HOME_MODULES.map((module) => {
    const fallback = module.defaultEnabled !== undefined ? module.defaultEnabled : true;
    const moduleEnabled = module.moduleKey
      ? featureEnabled(tenant, module.moduleKey, fallback)
      : true;
    const featureOn = module.featureKey
      ? featureEnabled(tenant, module.featureKey, fallback)
      : true;
    const tenantEnabled = moduleEnabled && featureOn;
    const needsSignIn = tenantEnabled && module.authRequired && !isAuthenticated;
    const available = tenantEnabled && (!module.authRequired || isAuthenticated);

    return {
      ...module,
      title: t(module.titleKey),
      description: t(module.descriptionKey),
      href: needsSignIn ? '/login?status=auth-required' : module.href,
      available,
      needsSignIn,
      linked: available || needsSignIn
    };
  });
}

function platformStatsOptionsForRequest(req, tenant) {
  const routing = req.accessibleRouting || {};
  if (routing.mode === 'custom-domain') {
    return { host: normalizeRequestHost(req) || tenant.accessible_domain || '' };
  }

  const slug = tenant.slug || routing.tenantSlug || '';
  return slug ? { slug } : {};
}

async function loadTenantHomeData(req, res) {
  const { ApiOfflineError, getPlatformStats, getTenantBootstrap } = require('./lib/api');
  const routedTenant = req.accessibleRouting?.tenant && typeof req.accessibleRouting.tenant === 'object'
    ? req.accessibleRouting.tenant
    : {};
  let tenant = routedTenant;

  if (!tenant.slug && req.accessibleRouting?.tenantSlug) {
    try {
      tenant = dataFrom(await getTenantBootstrap({ slug: req.accessibleRouting.tenantSlug }));
      req.accessibleRouting.tenant = tenant;
      Object.assign(res.locals, buildShellLocals(req, res.locals.isAuthenticated));
    } catch (error) {
      if (!(error instanceof ApiOfflineError)) {
        throw error;
      }
      tenant = { slug: req.accessibleRouting.tenantSlug, name: req.accessibleRouting.tenantSlug };
    }
  }

  let stats = {};
  try {
    stats = dataFrom(await getPlatformStats(platformStatsOptionsForRequest(req, tenant)));
  } catch (error) {
    if (!(error instanceof ApiOfflineError)) {
      throw error;
    }
  }

  const communityName = tenant.name || tenant.slug || req.accessibleRouting?.tenantSlug || res.locals.tenantName;
  const networkCommunities = normalizeNetworkCommunities(tenant, req);
  const usesNetworkLanding = networkCommunities.length > 0 || Number(tenant.id) === 1;
  const configuredHomeHeading = usesNetworkLanding ? tenant.seo?.h1_headline : '';
  const homeHeading = configuredHomeHeading || 'Accessible';
  const homeHeadingKey = configuredHomeHeading ? '' : 'home.title';
  const configuredHomeDescription = usesNetworkLanding ? tenant.seo?.hero_intro : '';
  const homeDescription = configuredHomeDescription || '';
  const homeDescriptionKey = configuredHomeDescription ? '' : 'home.description';

  return {
    tenant,
    communityName,
    homeHeading,
    homeHeadingKey,
    homeDescription,
    homeDescriptionKey,
    tagline: tenant.tagline || '',
    networkCommunities,
    stats: {
      members: numberLabel(stats.members, res.locals.formatLocaleNumber),
      hoursExchanged: numberLabel(stats.hours_exchanged ?? stats.hoursExchanged, res.locals.formatLocaleNumber),
      listings: numberLabel(stats.listings, res.locals.formatLocaleNumber),
      communities: numberLabel(stats.communities, res.locals.formatLocaleNumber)
    },
    modules: buildHomeModules(tenant, res.locals.isAuthenticated, res.locals.t)
  };
}

// Public routes (no CSRF needed for GET)
app.get('/', async (req, res) => {
  if (req.accessibleRouting?.mode) {
    const homeData = await loadTenantHomeData(req, res);
    return res.render('home', {
      title: 'Accessible',
      titleKey: 'home.title',
      activeNav: 'home',
      status: typeof req.query.status === 'string' ? req.query.status : '',
      ...homeData
    });
  }

  const { ApiOfflineError, getTenants } = require('./lib/api');

  try {
    const result = await getTenants({ includeMaster: false });
    return res.render('tenant-chooser', {
      title: 'Choose a community',
      activeNav: '',
      tenants: normalizeTenantChooserCommunities(result),
      tenantLoadError: false
    });
  } catch (error) {
    if (error instanceof ApiOfflineError) {
      return res.render('tenant-chooser', {
        title: 'Choose a community',
        activeNav: '',
        tenants: [],
        tenantLoadError: true
      });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }
});

app.get('/health', (req, res) => {
  if (!sessionStore.isReady()) {
    return res.status(503).type('text/plain').send('NOT READY');
  }
  res.type('text/plain').send('OK');
});

// Session touch endpoint - called by timeout-warning.js to extend the session
// Touching this endpoint is enough to reset the express-session rolling window
app.post('/session/touch', doubleCsrfProtection, (req, res) => {
  // express-session resave:false means we must mark it dirty to reset maxAge
  if (req.session) {
    req.session.touch = Date.now();
  }
  res.json({ ok: true });
});

app.get('/cookies', (req, res) => {
  res.render('cookie-settings', {
    title: 'Cookies',
    activeNav: '',
    status: typeof req.query.status === 'string' ? req.query.status : '',
    analyticsOn: (req.cookies[ACCESSIBLE_COOKIE_NAME] || req.cookies[LEGACY_ALPHA_COOKIE_NAME]) === 'all'
  });
});

app.post('/cookie-consent', doubleCsrfProtection, (req, res) => {
  const choice = typeof req.body.cookies === 'string' ? req.body.cookies : '';
  const analyticsOn = choice === 'accept' || (choice === 'save' && req.body.analytics === 'yes');
  const cookieValue = analyticsOn ? 'all' : 'essential';

  res.cookie(ACCESSIBLE_COOKIE_NAME, cookieValue, {
    path: '/',
    maxAge: ALPHA_COOKIE_MAX_AGE,
    sameSite: 'lax',
    secure: NODE_ENV === 'production',
    httpOnly: false
  });

  if (choice === 'save') {
    return redirectTo(res, '/cookies?status=saved');
  }

  if (req.session) {
    req.session.alphaCookieChoice = analyticsOn ? 'accepted' : 'rejected';
  }

  const returnPath = safeLocalPath(req.body.return, '');
  if (!returnPath) {
    return redirectTo(res, '/');
  }

  return redirectTo(res, returnPath);
});

app.get('/account', async (req, res) => {
  const token = req.signedCookies?.token;

  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const tenant = req.accessibleRouting?.tenant && typeof req.accessibleRouting.tenant === 'object'
    ? req.accessibleRouting.tenant
    : {};
  let directMessagingEnabled = false;
  try {
    const exchangeConfig = dataFrom(await getExchangeConfig(token));
    directMessagingEnabled = exchangeConfig.direct_messaging_enabled === true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      handleApiError(error, req, res, { redirectOn401: '/login?status=auth-required' });
      return undefined;
    }
    // Fail closed: Laravel Blade hides this card when broker messaging is off.
  }

  res.render('account', {
    title: 'My account',
    titleKey: 'account.title',
    activeNav: 'account',
    accountLinks: buildAccountLinks({
      tenant,
      unreadMessageCount: res.locals.unreadMessageCount,
      directMessagingEnabled,
      t: req.t || res.locals.t
    })
  });
});

app.use('/explore', exploreRoutes);

app.get('/volunteering', requireAuth, (req, res) => {
  const { callVolunteeringApi, getVolunteeringCategories, getVolunteeringOpportunities } = require('./lib/api');
  const token = req.signedCookies.token || '';
  if (res.locals.volunteeringDisabled) {
    return res.status(403).render('volunteering', {
      title: res.locals.t('volunteering.title'),
      activeNav: 'volunteering',
      moduleDisabled: true,
      authRequired: !token
    });
  }
  const requestedTab = ['applications', 'recommended', 'community_projects'].includes(req.query.tab)
    ? req.query.tab
    : 'opportunities';
  const selectedTab = token ? requestedTab : 'opportunities';
  const applicationStatus = ['pending', 'approved', 'declined', 'withdrawn'].includes(req.query.app_status)
    ? req.query.app_status
    : '';
  const applicationCursor = typeof req.query.app_cursor === 'string' ? req.query.app_cursor.trim() : '';
  const volunteeringQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const categoryId = typeof req.query.category_id === 'string' ? req.query.category_id.trim() : '';
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor.trim() : '';
  const remoteValue = typeof req.query.is_remote === 'string'
    ? req.query.is_remote
    : (typeof req.query.remote === 'string' ? req.query.remote : '');
  const isRemote = ['1', 'true', 'on', 'yes'].includes(String(remoteValue).toLowerCase());
  const filters = { per_page: 20 };

  if (volunteeringQuery) {
    filters.search = volunteeringQuery;
  }

  if (categoryId) {
    filters.category_id = categoryId;
  }

  if (isRemote) {
    filters.is_remote = true;
  }

  if (cursor) {
    filters.cursor = cursor;
  }

  const normalizeOpportunity = (opportunity) => {
    const organization = opportunity.organization && typeof opportunity.organization === 'object'
      ? opportunity.organization
      : {};
    const category = opportunity.category && typeof opportunity.category === 'object'
      ? opportunity.category
      : {};
    const description = opportunity.description || opportunity.summary || '';

    return {
      ...opportunity,
      organizationName: opportunity.org_name || opportunity.organisation_name || organization.name || '',
      categoryName: category.name || (typeof opportunity.category === 'string' ? opportunity.category : ''),
      summary: description.length > 220 ? `${description.slice(0, 217)}...` : description
    };
  };

  const buildLoadMoreHref = (nextCursor) => {
    const loadMoreParams = new URLSearchParams();
    if (volunteeringQuery) loadMoreParams.set('q', volunteeringQuery);
    if (categoryId) loadMoreParams.set('category_id', categoryId);
    if (isRemote) loadMoreParams.set('is_remote', '1');
    if (nextCursor) loadMoreParams.set('cursor', nextCursor);
    const queryString = loadMoreParams.toString();

    return queryString ? `/volunteering?${queryString}` : '';
  };

  const applicationsQuery = new URLSearchParams({ per_page: '10' });
  if (applicationStatus) applicationsQuery.set('status', applicationStatus);
  if (applicationCursor) applicationsQuery.set('cursor', applicationCursor);
  const applicationsPromise = selectedTab === 'applications'
    ? callVolunteeringApi(token, 'GET', `/applications?${applicationsQuery.toString()}`)
    : Promise.resolve({ data: [], meta: {} });
  const hoursSummaryPromise = token
    ? callVolunteeringApi(token, 'GET', '/hours/summary').catch(() => ({ data: {} }))
    : Promise.resolve({ data: {} });
  const organisationsPromise = token
    ? callVolunteeringApi(token, 'GET', '/my-organisations?per_page=5').catch(() => ({ data: [] }))
    : Promise.resolve({ data: [] });
  const categoriesPromise = getVolunteeringCategories(token).catch(() => ({ data: [] }));
  const recommendedPromise = selectedTab === 'recommended'
    ? callVolunteeringApi(token, 'GET', '/recommended-shifts?limit=10').catch(() => ({ data: [] }))
    : Promise.resolve({ data: [] });
  const communityProjectsPromise = selectedTab === 'community_projects'
    ? callVolunteeringApi(token, 'GET', '/community-projects?public=true&limit=12').catch(() => ({ data: [] }))
    : Promise.resolve({ data: [] });

  Promise.all([getVolunteeringOpportunities(filters, token), applicationsPromise, hoursSummaryPromise, organisationsPromise, categoriesPromise, recommendedPromise, communityProjectsPromise])
    .then(([result, applicationsResult, hoursSummaryResult, organisationsResult, categoriesResult, recommendedResult, communityProjectsResult]) => {
      const opportunities = Array.isArray(result?.data)
        ? result.data
        : (Array.isArray(result?.items) ? result.items : []);
      const meta = result?.meta && typeof result.meta === 'object' ? result.meta : {};
      const nextCursor = typeof meta.cursor === 'string' ? meta.cursor : '';
      const applications = Array.isArray(applicationsResult?.data)
        ? applicationsResult.data
        : (Array.isArray(applicationsResult?.items) ? applicationsResult.items : []);
      const normalizedApplications = applications.map((application) => ({
        ...application,
        appliedOnLabel: application?.created_at
          ? formatLocaleDate(new Date(application.created_at), getRequestLocale() || 'en', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          })
          : ''
      }));
      const applicationsMeta = applicationsResult?.meta && typeof applicationsResult.meta === 'object'
        ? applicationsResult.meta
        : {};
      const hoursSummary = hoursSummaryResult?.data && typeof hoursSummaryResult.data === 'object'
        ? hoursSummaryResult.data
        : {};
      const hoursSummaryLabels = {
        approved: Number(hoursSummary.total_approved_hours ?? hoursSummary.approved_hours ?? 0).toFixed(1),
        pending: Number(hoursSummary.pending_hours ?? 0).toFixed(1),
        thisMonth: Number(hoursSummary.this_month_hours ?? 0).toFixed(1)
      };
      const organisations = Array.isArray(organisationsResult?.data) ? organisationsResult.data : [];
      const categories = Array.isArray(categoriesResult?.data) ? categoriesResult.data : [];
      const recommendedShifts = (Array.isArray(recommendedResult?.data) ? recommendedResult.data : []).map((shift) => {
        const startText = String(shift?.start_time || '');
        const startParts = startText.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
        const locale = getRequestLocale() || 'en';
        const year = startParts ? Number(startParts[1]) : 0;
        const monthIndex = startParts ? Number(startParts[2]) - 1 : -1;
        const day = startParts ? Number(startParts[3]) : 0;
        const hours = startParts ? Number(startParts[4]) : -1;
        const minutes = startParts ? Number(startParts[5]) : -1;
        const validStart = startParts
          && monthIndex >= 0 && monthIndex <= 11
          && day >= 1 && day <= 31
          && hours >= 0 && hours <= 23
          && minutes >= 0 && minutes <= 59;
        const month = validStart
          ? new Intl.DateTimeFormat(localeForIntl(locale), { month: 'long', timeZone: 'UTC' })
            .format(new Date(Date.UTC(year, monthIndex, day)))
          : '';
        const hour = hours % 12 || 12;
        const startTimeLabel = validStart
          ? `${day} ${month} ${year}, ${hour}:${String(minutes).padStart(2, '0')}${hours < 12 ? 'am' : 'pm'}`
          : '';
        return {
          ...shift,
          startTimeLabel
        };
      });
      const communityProjects = Array.isArray(communityProjectsResult?.data) ? communityProjectsResult.data : [];
      const manageableOrganisations = organisations.filter((organisation) => (
        ['owner', 'admin'].includes(String(organisation?.member_role || 'member'))
        && ['approved', 'active'].includes(String(organisation?.status || 'pending'))
      ));
      const pendingOwnedOrganisations = organisations.filter((organisation) => (
        ['owner', 'admin'].includes(String(organisation?.member_role || 'member'))
        && !['approved', 'active'].includes(String(organisation?.status || 'pending'))
      ));
      const applicationsLoadMore = new URLSearchParams({ tab: 'applications' });
      if (applicationStatus) applicationsLoadMore.set('app_status', applicationStatus);
      if (applicationsMeta.cursor) applicationsLoadMore.set('app_cursor', applicationsMeta.cursor);

      res.render('volunteering', {
        title: res.locals.t('volunteering.title'),
        activeNav: 'volunteering',
        opportunities: opportunities.map(normalizeOpportunity),
        applications: normalizedApplications,
        applicationsMeta,
        applicationsLoadMoreHref: `/volunteering?${applicationsLoadMore.toString()}`,
        applicationStatus,
        hoursSummary,
        hoursSummaryLabels,
        manageableOrganisations,
        pendingOwnedOrganisations,
        categories,
        recommendedShifts,
        communityProjects,
        selectedTab,
        status: typeof req.query.status === 'string' ? req.query.status : '',
        volunteeringQuery,
        categoryId,
        isRemote,
        error: false,
        hasMore: !!meta.has_more && !!nextCursor,
        loadMoreHref: buildLoadMoreHref(nextCursor),
        authRequired: !token,
        csrfToken: req.csrfToken ? req.csrfToken() : ''
      });
    })
    .catch(() => {
      res.render('volunteering', {
        title: res.locals.t('volunteering.title'),
        activeNav: 'volunteering',
        opportunities: [],
        applications: [],
        applicationsMeta: {},
        applicationsLoadMoreHref: '',
        applicationStatus,
        hoursSummary: {},
        hoursSummaryLabels: { approved: '0.0', pending: '0.0', thisMonth: '0.0' },
        manageableOrganisations: [],
        pendingOwnedOrganisations: [],
        categories: [],
        recommendedShifts: [],
        communityProjects: [],
        selectedTab,
        status: typeof req.query.status === 'string' ? req.query.status : '',
        volunteeringQuery,
        categoryId,
        isRemote,
        error: true,
        hasMore: false,
        loadMoreHref: '',
        authRequired: !token,
        csrfToken: req.csrfToken ? req.csrfToken() : ''
      });
    });
});

app.get('/volunteering/opportunities/:id(\\d+)', requireAuth, (req, res) => {
  const token = req.signedCookies.token || '';
  const { ApiError, getVolunteerOpportunity } = require('./lib/api');

  const normalizeOpportunity = (result) => {
    const opportunity = result?.data && typeof result.data === 'object' ? result.data : {};
    const organization = opportunity.organization && typeof opportunity.organization === 'object'
      ? opportunity.organization
      : {};
    const category = opportunity.category && typeof opportunity.category === 'object'
      ? opportunity.category
      : {};
    const organisationId = opportunity.organization_id || opportunity.organisation_id || organization.id || 0;
    const organisationName = opportunity.org_name || opportunity.organisation_name || organization.name || '';
    const shifts = (Array.isArray(opportunity.shifts) ? opportunity.shifts : []).map((shift) => {
      const startTime = Date.parse(shift?.start_time || '');
      return {
        ...shift,
        isPast: Number.isFinite(startTime) && startTime < Date.now(),
        spacesAvailable: shift?.spots_available === undefined || shift?.spots_available === null
          ? shift?.capacity
          : shift.spots_available,
        hasSpace: shift?.spots_available === undefined
          || shift?.spots_available === null
          || Number(shift.spots_available) > 0
      };
    });
    const application = opportunity.application && typeof opportunity.application === 'object'
      ? opportunity.application
      : null;
    const isApprovedApplicant = application?.status === 'approved';

    return {
      ...opportunity,
      organization: {
        ...organization,
        logo_url: resolveBackendAssetUrl(organization.logo_url || organization.logoUrl)
      },
      organisationId,
      organisationName,
      categoryName: category.name || (typeof opportunity.category === 'string' ? opportunity.category : ''),
      shifts,
      hasApplied: Boolean(opportunity.has_applied),
      application,
      isApprovedApplicant,
      signedUpShiftId: isApprovedApplicant ? Number(application.shift_id) || 0 : 0
    };
  };

  return getVolunteerOpportunity(req.params.id, token)
    .then((result) => {
      const opportunity = normalizeOpportunity(result);
      const status = typeof req.query.status === 'string' ? req.query.status : '';
      const safeguardingMessage = (key, fallback) => {
        const translated = res.locals.t(key);
        return translated !== key ? translated : fallback;
      };
      const statusPresentation = {
        'apply-created': ['success', res.locals.t('govuk_alpha.volunteering.apply_created')],
        'apply-failed': ['error', res.locals.t('govuk_alpha.volunteering.apply_failed')],
        'apply-safeguarding-restricted': ['error', safeguardingMessage(
          'safeguarding.errors.interaction_not_allowed',
          'The recipient\u2019s community safeguarding policy does not allow this direct interaction. Ask a coordinator for help.'
        )],
        'apply-safeguarding-unavailable': ['error', safeguardingMessage(
          'safeguarding.errors.policy_unavailable',
          'We cannot confirm the community safeguarding policy right now. No message has been sent. Please try again shortly.'
        )],
        'shift-signed-up': ['success', res.locals.t('govuk_alpha.volunteering.shift_signed_up_detail')],
        'shift-cancelled': ['success', res.locals.t('govuk_alpha.volunteering.shift_cancelled_detail')],
        'shift-signup-failed': ['error', res.locals.t('govuk_alpha.volunteering.shift_signup_failed')],
        'shift-cancel-failed': ['error', res.locals.t('govuk_alpha.volunteering.shift_cancel_failed')],
        'shift-safeguarding-restricted': ['error', safeguardingMessage(
          'safeguarding.errors.interaction_not_allowed',
          'The recipient\u2019s community safeguarding policy does not allow this direct interaction. Ask a coordinator for help.'
        )],
        'shift-safeguarding-unavailable': ['error', safeguardingMessage(
          'safeguarding.errors.policy_unavailable',
          'We cannot confirm the community safeguarding policy right now. No message has been sent. Please try again shortly.'
        )]
      }[status] || null;

      res.render('volunteer-opportunity', {
        title: opportunity.title || res.locals.t('govuk_alpha.volunteering.detail_title'),
        activeNav: 'volunteering',
        opportunity,
        opportunityId: req.params.id,
        authRequired: !token,
        status: statusPresentation ? {
          type: statusPresentation[0],
          message: statusPresentation[1]
        } : null,
        csrfToken: req.csrfToken ? req.csrfToken() : ''
      });
    })
    .catch((error) => {
      if (error instanceof ApiError && error.status === 404) {
        return res.status(404).render('errors/404', { title: 'Page not found' });
      }

      return res.status(503).render('errors/503', { title: 'Service unavailable' });
    });
});

function requireOrganisationAuth(req, res, next) {
  if (!req.signedCookies || !req.signedCookies.token) {
    return redirectTo(res, '/login?status=auth-required');
  }
  return next();
}

app.get('/organisations', requireOrganisationAuth, (req, res) => {
  const organisationsQuery = typeof req.query.q === 'string' ? req.query.q : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const values = req.session?.organisationEmbeddedValues || {};
  if (req.session) delete req.session.organisationEmbeddedValues;

  const { getVolunteerOrganisations } = require('./lib/api');
  const filters = { per_page: 30 };
  if (organisationsQuery.trim()) {
    filters.search = organisationsQuery.trim();
  }

  getVolunteerOrganisations(filters)
    .then((result) => {
      const organisations = (Array.isArray(result?.data) ? result.data : []).map((organisation) => {
        const description = String(organisation?.description || '').trim();
        return {
          ...organisation,
          name: String(organisation?.name ?? '').trim()
            || res.locals.t('govuk_alpha.organisations.title'),
          summary: description.length > 160 ? `${description.slice(0, 157)}...` : description
        };
      });

      res.render('organisations', {
        title: res.locals.t('govuk_alpha.organisations.title'),
        activeNav: 'explore',
        organisations,
        organisationsQuery,
        status,
        values
      });
    })
    .catch(() => {
      res.render('organisations', {
        title: res.locals.t('govuk_alpha.organisations.title'),
        activeNav: 'explore',
        organisations: [],
        organisationsQuery,
        status,
        values
      });
    });
});

app.get('/organisations/browse', requireOrganisationAuth, (req, res) => {
  const organisationsQuery = typeof req.query.q === 'string' ? req.query.q : '';
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';
  const token = req.signedCookies.token;
  const { getMyVolunteerOrganisations, getVolunteerOrganisations } = require('./lib/api');
  const filters = { per_page: 20 };

  if (organisationsQuery.trim()) {
    filters.search = organisationsQuery.trim();
  }

  if (cursor.trim()) {
    filters.cursor = cursor.trim();
  }

  Promise.allSettled([
    getVolunteerOrganisations(filters),
    getMyVolunteerOrganisations(token, { per_page: 50 })
  ])
    .then(([directoryResult, mineResult]) => {
      if (directoryResult.status === 'rejected') {
        throw directoryResult.reason;
      }

      const result = directoryResult.value;
      const organisations = Array.isArray(result?.data) ? result.data : [];
      const meta = result?.meta && typeof result.meta === 'object' ? result.meta : {};
      const nextCursor = typeof meta.cursor === 'string' ? meta.cursor : '';
      const minePayload = mineResult.status === 'fulfilled' ? mineResult.value : {};
      const mine = Array.isArray(minePayload?.items)
        ? minePayload.items
        : (Array.isArray(minePayload?.data) ? minePayload.data : []);
      const manageableCount = mine.filter((organisation) => {
        const status = String(organisation.status || '');
        const role = String(organisation.member_role || organisation.role || '');
        return ['approved', 'active'].includes(status) && ['owner', 'admin'].includes(role);
      }).length;
      const loadMoreParams = new URLSearchParams();

      if (organisationsQuery.trim()) {
        loadMoreParams.set('q', organisationsQuery.trim());
      }

      if (nextCursor) {
        loadMoreParams.set('cursor', nextCursor);
      }

      const loadMoreQuery = loadMoreParams.toString();

      res.render('organisations-browse', {
        title: res.locals.t('govuk_alpha_organisations.browse.title'),
        activeNav: 'explore',
        organisations: organisations.map((organisation) => {
          const publicContract = organisation.public_contract && typeof organisation.public_contract === 'object'
            ? organisation.public_contract
            : {};
          const stats = publicContract.stats && typeof publicContract.stats === 'object'
            ? publicContract.stats
            : (organisation.stats && typeof organisation.stats === 'object' ? organisation.stats : {});
          const name = String(organisation.name ?? '').trim()
            || res.locals.t('govuk_alpha_organisations.browse.title');
          const description = String(organisation.description ?? '');
          const summary = description.trim() === ''
            ? ''
            : (description.length > 160 ? `${description.slice(0, 157)}...` : description);
          const opportunityCount = Number(stats.opportunity_count ?? organisation.opportunity_count ?? 0);
          const volunteerCount = Number(stats.volunteer_count ?? organisation.volunteer_count ?? 0);
          const totalHours = Number(stats.total_hours ?? organisation.total_hours ?? 0);
          const averageRating = Number(stats.average_rating ?? organisation.average_rating ?? 0);
          const normalizedTotalHours = Number.isFinite(totalHours) ? totalHours : 0;
          const normalizedAverageRating = Number.isFinite(averageRating) ? averageRating : 0;

          return {
            ...organisation,
            name,
            description,
            summary,
            opportunityCount: Number.isFinite(opportunityCount) ? Math.trunc(opportunityCount) : 0,
            volunteerCount: Number.isFinite(volunteerCount) ? Math.trunc(volunteerCount) : 0,
            totalHours: normalizedTotalHours,
            totalHoursLabel: res.locals.formatLocaleNumber(normalizedTotalHours, {
              minimumFractionDigits: Number.isInteger(normalizedTotalHours) ? 0 : 1,
              maximumFractionDigits: 1
            }),
            averageRating: normalizedAverageRating,
            averageRatingLabel: res.locals.formatLocaleNumber(normalizedAverageRating, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1
            }),
            hasWebsite: String(organisation.website ?? '').trim() !== ''
          };
        }),
        organisationsQuery,
        error: false,
        manageableCount,
        hasMore: !!meta.has_more && !!nextCursor,
        loadMoreHref: loadMoreQuery ? `/organisations/browse?${loadMoreQuery}` : ''
      });
    })
    .catch(() => {
      res.render('organisations-browse', {
        title: res.locals.t('govuk_alpha_organisations.browse.title'),
        activeNav: 'explore',
        organisations: [],
        organisationsQuery,
        error: true,
        manageableCount: 0,
        hasMore: false,
        loadMoreHref: ''
      });
    });
});

app.get('/organisations/register', requireOrganisationAuth, (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const values = req.session?.organisationRegistrationValues || {};
  if (req.session) delete req.session.organisationRegistrationValues;
  const errorMap = {
    'org-name-invalid': {
      field: 'name',
      key: 'govuk_alpha_organisations.register.errors.org-name-invalid'
    },
    'org-description-invalid': {
      field: 'description',
      key: 'govuk_alpha_organisations.register.errors.org-description-invalid'
    },
    'org-email-invalid': {
      field: 'email',
      key: 'govuk_alpha_organisations.register.errors.org-email-invalid'
    },
    'org-website-invalid': {
      field: 'website',
      key: 'govuk_alpha_organisations.register.errors.org-website-invalid'
    },
    'org-terms-required': {
      field: 'agreed_terms',
      key: 'govuk_alpha_organisations.register.errors.org-terms-required'
    },
    'org-failed': {
      field: 'name',
      key: 'govuk_alpha_organisations.register.errors.org-failed'
    }
  };
  const activeError = errorMap[status] || null;

  res.render('organisations-register', {
    title: res.locals.t('govuk_alpha_organisations.register.title'),
    activeNav: 'explore',
    activeErrorField: activeError ? activeError.field : '',
    activeErrorMessage: activeError ? res.locals.t(activeError.key) : '',
    values
  });
});

function trimBodyValue(body, field) {
  const value = body && typeof body[field] === 'string' ? body[field] : '';
  return value.trim();
}

function buildOrganisationRegistrationPayload(body) {
  return {
    name: trimBodyValue(body, 'name'),
    description: trimBodyValue(body, 'description'),
    contact_email: trimBodyValue(body, 'contact_email') || trimBodyValue(body, 'email'),
    website: trimBodyValue(body, 'website')
  };
}

function acceptedOrganisationTerms(value) {
  return ['1', 'on', 'true'].includes(String(value || '').toLowerCase());
}

function unicodeLength(value) {
  return Array.from(String(value || '')).length;
}

function unicodeSlice(value, maximumLength) {
  return Array.from(String(value || '')).slice(0, maximumLength).join('');
}

function organisationRegistrationStatus(payload, agreedTerms) {
  if (unicodeLength(payload.name) < 3) return 'org-name-invalid';
  if (unicodeLength(payload.description) < 20) return 'org-description-invalid';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.contact_email)) return 'org-email-invalid';
  if (payload.website && !/^https?:\/\//i.test(payload.website)) return 'org-website-invalid';
  if (!agreedTerms) return 'org-terms-required';
  return '';
}

async function handleOrganisationRegistrationPost(req, res, options = {}) {
  const token = req.signedCookies.token;
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const payload = buildOrganisationRegistrationPayload(req.body);
  const invalidStatus = organisationRegistrationStatus(
    payload,
    acceptedOrganisationTerms(req.body.agreed_terms)
  );

  if (invalidStatus) {
    if (req.session) {
      req.session[options.coarseInvalid ? 'organisationEmbeddedValues' : 'organisationRegistrationValues'] = {
        name: payload.name,
        description: payload.description,
        email: payload.contact_email,
        website: payload.website,
        agreedTerms: acceptedOrganisationTerms(req.body.agreed_terms)
      };
    }
    const invalidRedirect = options.coarseInvalid
      ? '/organisations?status=org-invalid'
      : `/organisations/register?status=${invalidStatus}`;
    return redirectTo(res, invalidRedirect);
  }

  const { ApiOfflineError, createVolunteerOrganisation } = require('./lib/api');
  try {
    await createVolunteerOrganisation(token, {
      name: unicodeSlice(payload.name, 255),
      description: payload.description,
      contact_email: payload.contact_email,
      website: payload.website || undefined
    });
  } catch (error) {
    if (error instanceof ApiOfflineError) {
      return res.status(503).render('errors/503', { title: 'Service unavailable' });
    }

    if (req.session) {
      req.session[options.coarseInvalid ? 'organisationEmbeddedValues' : 'organisationRegistrationValues'] = {
        name: payload.name,
        description: payload.description,
        email: payload.contact_email,
        website: payload.website,
        agreedTerms: acceptedOrganisationTerms(req.body.agreed_terms)
      };
    }
    const failedRedirect = options.coarseInvalid
      ? '/organisations?status=org-failed'
      : '/organisations/register?status=org-failed';
    return redirectTo(res, failedRedirect);
  }

  if (req.session) {
    delete req.session[options.coarseInvalid ? 'organisationEmbeddedValues' : 'organisationRegistrationValues'];
  }
  return redirectTo(res, '/organisations?status=org-submitted');
}

app.post('/organisations', formLimiter, doubleCsrfProtection, (req, res) => {
  return handleOrganisationRegistrationPost(req, res, { coarseInvalid: true });
});

app.post('/organisations/register', formLimiter, doubleCsrfProtection, handleOrganisationRegistrationPost);

app.get('/organisations/manage', requireOrganisationAuth, (req, res) => {
  const token = req.signedCookies.token;
  const renderManage = ({ organisations = [], error = false, authRequired = false } = {}) => {
    const normalizedOrganisations = organisations
      .filter((organisation) => organisation && typeof organisation === 'object' && organisation.id)
      .map((organisation) => ({
        ...organisation,
        name: String(organisation.name ?? '').trim()
          || res.locals.t('govuk_alpha_organisations.manage.title'),
        status: String(organisation.status ?? ''),
        member_role: String(organisation.member_role ?? 'member')
      }));
    const manageableOrganisations = normalizedOrganisations.filter((organisation) => {
      const status = organisation.status;
      const role = organisation.member_role;
      return ['approved', 'active'].includes(status) && ['owner', 'admin'].includes(role);
    });
    const pendingOrganisations = normalizedOrganisations
      .filter((organisation) => organisation.status === 'pending');

    res.render('organisations-manage', {
      title: res.locals.t('govuk_alpha_organisations.manage.title'),
      activeNav: 'explore',
      manageableOrganisations,
      pendingOrganisations,
      error,
      authRequired
    });
  };

  if (!token) {
    return renderManage({ authRequired: true });
  }

  const { getMyVolunteerOrganisations } = require('./lib/api');
  return getMyVolunteerOrganisations(token, { per_page: 50 })
    .then((result) => {
      const organisations = Array.isArray(result?.items)
        ? result.items
        : (Array.isArray(result?.data) ? result.data : []);
      renderManage({ organisations });
    })
    .catch(() => {
      renderManage({ error: true });
    });
});

app.get('/organisations/:id(\\d+)/jobs', requireOrganisationAuth, (req, res) => {
  const { ApiError, getVolunteerOrganisation } = require('./lib/api');
  const token = req.signedCookies.token || '';

  const normalizeOrganisation = (result) => {
    const data = result?.data && typeof result.data === 'object' ? result.data : {};
    const publicContract = data.public_contract && typeof data.public_contract === 'object'
      ? data.public_contract
      : {};

    return {
      ...data,
      ...publicContract
    };
  };

  const renderJobs = (organisation) => {
    const name = String(organisation.name ?? '').trim()
      || res.locals.t('govuk_alpha_organisations.jobs.title');
    const description = String(organisation.description ?? '').trim();
    const website = String(organisation.website ?? '').trim();
    const email = String(organisation.email ?? organisation.contact_email ?? '').trim();
    const logo = String(organisation.logo_url ?? '').trim();
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name
    };
    if (description) structuredData.description = Array.from(description).slice(0, 300).join('');
    if (logo) structuredData.logo = logo;
    if (website) structuredData.url = website;
    if (email) structuredData.email = email;

    res.render('organisations-jobs', {
      title: res.locals.t('govuk_alpha_organisations.jobs.title'),
      activeNav: 'explore',
      organisation: { ...organisation, name },
      organisationStructuredData: inlineScriptJson(structuredData),
      jobs: []
    });
  };

  return getVolunteerOrganisation(req.params.id, token)
    .then((result) => {
      const organisation = normalizeOrganisation(result);

      return renderJobs(organisation);
    })
    .catch((error) => {
      if (error instanceof ApiError && error.status === 404) {
        return res.status(404).render('errors/404', { title: 'Page not found' });
      }

      return res.status(503).render('errors/503', { title: 'Service unavailable' });
    });
});

app.get('/organisations/opportunities/:id(\\d+)/apply', requireOrganisationAuth, (req, res) => {
  const token = req.signedCookies.token || '';
  const { ApiError, getVolunteerOpportunity } = require('./lib/api');

  const normalizeOpportunity = (result) => {
    const opportunity = result?.data && typeof result.data === 'object' ? result.data : {};
    const organization = opportunity.organization && typeof opportunity.organization === 'object'
      ? opportunity.organization
      : {};
    const parsedOrganisationId = Number.parseInt(String(opportunity.organization_id ?? ''), 10);
    const organisationId = Number.isInteger(parsedOrganisationId) && parsedOrganisationId > 0
      ? parsedOrganisationId
      : 0;
    const organisationName = String(opportunity.org_name ?? organization.name ?? '').trim();
    const title = String(opportunity.title ?? '').trim()
      || res.locals.t('govuk_alpha_organisations.apply.title');

    return {
      ...opportunity,
      title,
      organisationId,
      organisationName,
      hasApplied: !!opportunity.has_applied
    };
  };

  return getVolunteerOpportunity(req.params.id, token)
    .then((result) => {
      const opportunity = normalizeOpportunity(result);

      res.render('organisations-apply', {
        title: res.locals.t('govuk_alpha_organisations.apply.title'),
        activeNav: 'explore',
        opportunity,
        opportunityId: req.params.id,
        authRequired: !token
      });
    })
    .catch((error) => {
      if (error instanceof ApiError && error.status === 404) {
        return res.status(404).render('errors/404', { title: 'Page not found' });
      }

      return res.status(503).render('errors/503', { title: 'Service unavailable' });
    });
});

app.get('/organisations/:id(\\d+)', requireOrganisationAuth, (req, res) => {
  const token = req.signedCookies.token || '';
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const {
    ApiError,
    getOrganisationOpportunities,
    getOrganisationReviews,
    getVolunteerOrganisation
  } = require('./lib/api');

  getVolunteerOrganisation(req.params.id, token)
    .then(async (result) => {
      const data = result?.data && typeof result.data === 'object' ? result.data : {};
      const publicContract = data.public_contract && typeof data.public_contract === 'object'
        ? data.public_contract
        : {};
      const stats = publicContract.stats && typeof publicContract.stats === 'object'
        ? publicContract.stats
        : (data.stats && typeof data.stats === 'object' ? data.stats : {});
      const organisation = {
        ...data,
        ...publicContract,
        stats
      };
      const parsedOrganisationId = Number.parseInt(String(organisation.id ?? ''), 10);
      organisation.id = Number.isInteger(parsedOrganisationId) && parsedOrganisationId > 0
        ? parsedOrganisationId
        : 0;
      organisation.name = String(organisation.name ?? '').trim()
        || res.locals.t('govuk_alpha.organisations.title');
      organisation.description = String(organisation.description ?? '').trim();
      const website = typeof organisation.website === 'string' ? organisation.website.trim() : '';
      const websiteHref = website
        ? (website.startsWith('http://') || website.startsWith('https://') ? website : `https://${website}`)
        : '';
      const contactEmail = String(organisation.email ?? organisation.contact_email ?? '').trim();
      const [opportunitiesResult, reviewsResult] = await Promise.allSettled([
        getOrganisationOpportunities(req.params.id, { per_page: 10 }),
        getOrganisationReviews(req.params.id)
      ]);
      const opportunitiesPayload = opportunitiesResult.status === 'fulfilled' ? opportunitiesResult.value : null;
      const reviewsPayload = reviewsResult.status === 'fulfilled' ? reviewsResult.value : null;
      const opportunities = Array.isArray(opportunitiesPayload?.data)
        ? opportunitiesPayload.data
        : (Array.isArray(opportunitiesPayload?.items) ? opportunitiesPayload.items : []);
      const reviewsData = reviewsPayload?.data && typeof reviewsPayload.data === 'object'
        ? reviewsPayload.data
        : {};
      const reviews = Array.isArray(reviewsData.reviews)
        ? reviewsData.reviews
        : (Array.isArray(reviewsPayload?.reviews) ? reviewsPayload.reviews : []);
      const opportunityCount = Number(stats.opportunity_count ?? opportunities.length);
      const rawVolunteerCount = organisation.volunteer_count ?? stats.volunteer_count;
      const volunteerCount = rawVolunteerCount === null || rawVolunteerCount === undefined
        ? null
        : Number(rawVolunteerCount);
      const totalHours = Number(stats.total_hours || 0);
      const reviewCount = Number(stats.review_count ?? reviews.length);
      const averageRating = Number(stats.average_rating || 0);

      res.render('organisation-detail', {
        title: organisation.name,
        activeNav: 'explore',
        organisation,
        orgStats: {
          opportunityCount: Number.isFinite(opportunityCount) ? opportunityCount : opportunities.length,
          volunteerCount: Number.isFinite(volunteerCount) ? volunteerCount : null,
          totalHoursLabel: res.locals.formatLocaleNumber(Number.isFinite(totalHours) ? totalHours : 0, {
            minimumFractionDigits: Number.isInteger(totalHours) ? 0 : 1,
            maximumFractionDigits: 1
          }),
          reviewCount: Number.isFinite(reviewCount) ? reviewCount : reviews.length,
          averageRating: Number.isFinite(averageRating) ? Math.max(0, Math.min(5, averageRating)) : 0,
          averageRatingLabel: res.locals.formatLocaleNumber(
            Number.isFinite(averageRating) ? Math.max(0, Math.min(5, averageRating)) : 0,
            { minimumFractionDigits: 1, maximumFractionDigits: 1 }
          )
        },
        orgOpportunities: opportunities.map((opportunity) => {
          const parsedOpportunityId = Number.parseInt(String(opportunity?.id ?? ''), 10);
          const id = Number.isInteger(parsedOpportunityId) && parsedOpportunityId > 0
            ? parsedOpportunityId
            : 0;
          const title = String(opportunity?.title ?? '').trim()
            || res.locals.t('govuk_alpha.organisations.title');
          const description = String(opportunity?.description ?? '').trim();
          return {
            ...opportunity,
            id,
            title,
            summary: unicodeLength(description) > 180
              ? `${unicodeSlice(description, 177)}...`
              : description
          };
        }),
        orgReviews: reviews.map((review) => {
          const author = review?.author && typeof review.author === 'object' ? review.author : {};
          const rating = Number(review?.rating || 0);
          return {
            ...review,
            authorName: String(author.name || '').trim() || res.locals.t('govuk_alpha.feed.unknown_author'),
            authorAvatar: resolveBackendAssetUrl(author.avatar || author.avatar_url),
            rating: Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.trunc(rating))) : 0,
            comment: String(review?.comment ?? '').trim()
          };
        }),
        contactEmail,
        website,
        websiteHref,
        jobVacanciesEnabled: featureEnabled(req.accessibleRouting?.tenant || {}, 'job_vacancies', true)
      });
    })
    .catch((error) => {
      if (error instanceof ApiError && error.status === 404) {
        return res.status(404).render('errors/404', { title: 'Page not found' });
      }

      return res.status(503).render('errors/503', { title: 'Service unavailable' });
    });
});

app.use('/resources/upload', parseMultipartForm({ maxFileSize: 10 * 1024 * 1024 }));
app.use('/volunteering/credentials', parseMultipartForm({ maxFileSize: 10 * 1024 * 1024 }));
app.use('/onboarding/avatar', parseMultipartForm({ maxFileSize: 10 * 1024 * 1024 }));
app.use(
  '/settings/insurance',
  parseMultipartForm({ maxFileSize: 10 * 1024 * 1024 }),
  multipartStatusErrorRedirect('/settings/insurance', 'insurance-file-large', 'insurance-file-required')
);
app.use(
  '/profile/settings',
  parseMultipartForm({ maxFileSize: 10 * 1024 * 1024 }),
  multipartStatusErrorRedirect('/profile/settings', 'avatar-invalid', 'avatar-invalid')
);
app.use(
  ['/profile/safeguarding/vetting-review', '/profile/safeguarding/policy-review'],
  parseMultipartForm({ maxFileSize: 1024 }),
  safeguardingEmptyMultipartErrorRedirect
);
app.use('/feed/posts', parseMultipartForm({ maxFileSize: 5 * 1024 * 1024 }));
app.use('/events/new', parseMultipartForm({ maxFileSize: 5 * 1024 * 1024 }));
app.use(/^\/events\/\d+\/edit$/, parseMultipartForm({ maxFileSize: 5 * 1024 * 1024 }));
app.use('/groups/new', parseMultipartForm({ maxFileSize: 8 * 1024 * 1024 }));
app.use(/^\/groups\/\d+\/edit$/, parseMultipartForm({ maxFileSize: 8 * 1024 * 1024 }));
app.use(/^\/groups\/\d+\/feed$/, parseMultipartForm({ maxFileSize: 5 * 1024 * 1024 }));
app.use('/listings/new', parseMultipartForm({ maxFileSize: 25 * 1024 * 1024 }));
app.use(/^\/listings\/\d+\/edit$/, parseMultipartForm({ maxFileSize: 25 * 1024 * 1024 }));
app.use(/^\/messages\/\d+$/, parseMultipartForm({ maxFileSize: 10 * 1024 * 1024, multiples: true }));
app.use(
  /^\/messages\/\d+\/voice$/,
  parseMultipartForm({ maxFileSize: 10 * 1024 * 1024 }),
  messageVoiceMultipartErrorRedirect
);
app.use(
  /^\/groups\/\d+\/image$/,
  parseMultipartForm({ maxFileSize: 8 * 1024 * 1024 }),
  groupMultipartErrorRedirect('image-failed', 'image-missing')
);
app.use(
  /^\/groups\/\d+\/files$/,
  parseMultipartForm({ maxFileSize: 25 * 1024 * 1024 }),
  groupMultipartErrorRedirect('file-too-large', 'file-missing')
);
app.use('/podcasts/studio/new', parseMultipartForm({ maxFileSize: 8 * 1024 * 1024 }));
app.use(/^\/podcasts\/studio\/\d+\/update$/, parseMultipartForm({ maxFileSize: 250 * 1024 * 1024 }));
app.use(/^\/podcasts\/studio\/\d+\/episodes$/, parseMultipartForm({ maxFileSize: 250 * 1024 * 1024 }));
// Parse a narrow amount above the product's 5 MB CV limit so the Jobs route
// can return its field-linked cv-too-large state; larger requests still fail
// closed in Formidable before application code sees them.
app.use(/^\/jobs\/\d+\/apply$/, parseMultipartForm({ maxFileSize: 6 * 1024 * 1024 }));

app.use(doubleCsrfProtection, postOnly(formLimiter), contactSupportRoutes);
app.use('/jobs', doubleCsrfProtection, postOnly(formLimiter), jobsRoutes);
app.use('/podcasts', doubleCsrfProtection, podcastRoutes);
app.use('/marketplace', doubleCsrfProtection, marketplaceRoutes);
app.use('/courses', doubleCsrfProtection, postOnly(formLimiter), coursesRoutes);
app.use('/premium', doubleCsrfProtection, postOnly(formLimiter), premiumRoutes);
app.use('/coupons', doubleCsrfProtection, postOnly(formLimiter), couponsRoutes);
app.use('/federation', federationRoutes);
app.use('/blog', doubleCsrfProtection, postOnly(formLimiter), blogPostRoutes);
app.use('/polls', doubleCsrfProtection, postOnly(formLimiter), pollActionRoutes);
app.use('/clubs', doubleCsrfProtection, postOnly(formLimiter), clubsRoutes);
app.use('/resources', doubleCsrfProtection, postOnly(formLimiter), resourcesRoutes);
app.use('/chat', doubleCsrfProtection, postOnly(formLimiter), aiChatRoutes);
app.use('/skills', doubleCsrfProtection, postOnly(formLimiter), skillsRoutes);
app.use('/exchanges', doubleCsrfProtection, postOnly(formLimiter), exchangeRoutes);
app.use('/goals', doubleCsrfProtection, postOnly(formLimiter), goalsRoutes);
app.use('/ideation', doubleCsrfProtection, postOnly(formLimiter), ideationRoutes, ideationActionRoutes);
app.use('/group-exchanges', doubleCsrfProtection, postOnly(formLimiter), groupExchangeRoutes, groupExchangeActionRoutes);
app.use('/kb', requireAuth, kbRoutes);
app.use(supportRoutes);
app.use(legalRoutes);
app.use(publicInfoRoutes);
app.use(staticPageRoutes);

app.get('/service-unavailable', (req, res) => {
  res.status(503).render('errors/503', { title: 'Service unavailable' });
});

// Auth routes (with stricter rate limiting on POST)
app.get('/login', authRoutes);
app.post('/login', authLimiter, doubleCsrfProtection, authRoutes);
app.get('/login/two-factor', authRoutes);
app.post('/login/two-factor', authLimiter, doubleCsrfProtection, authRoutes);
app.post('/login/resend-verification', authLimiter, doubleCsrfProtection, authRoutes);
app.get('/register', authRoutes);
app.post('/register', authLimiter, doubleCsrfProtection, authRoutes);
app.post('/logout', doubleCsrfProtection, authRoutes);
app.get('/login/forgot-password', authRoutes);
app.post('/login/forgot-password', authLimiter, doubleCsrfProtection, authRoutes);
app.get('/password/reset', authRoutes);
app.post('/password/reset', authLimiter, doubleCsrfProtection, authRoutes);

// Rate limit only on state-changing methods (POST/PUT/DELETE), not GET
function postOnly(limiter) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return next();
    }
    return limiter(req, res, next);
  };
}

function safeLocalPath(input, fallback = '/') {
  const value = typeof input === 'string' ? input.trim() : '';
  if (value && value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }
  return fallback;
}

function groupMultipartErrorRedirect(sizeStatus, invalidStatus) {
  return (error, req, res, next) => {
    const match = String(req.originalUrl || req.url || '').match(/\/groups\/(\d+)\/(image|files)(?:[?#]|$)/);
    if (!match) return next(error);

    const isSizeError = Number(error?.httpCode) === 413
      || Number(error?.code) === 1009
      || /max(?:imum)?\s*file\s*size|too large/i.test(String(error?.message || ''));
    const status = isSizeError ? sizeStatus : invalidStatus;
    return redirectTo(res, `/groups/${match[1]}/${match[2]}?status=${encodeURIComponent(status)}`);
  };
}

function messageVoiceMultipartErrorRedirect(error, req, res, next) {
  const match = String(req.originalUrl || req.url || '').match(/\/messages\/(\d+)\/voice(?:[?#]|$)/);
  if (!match) return next(error);

  return redirectTo(res, `/messages/${match[1]}?status=voice-failed`);
}

function multipartStatusErrorRedirect(pathname, sizeStatus, invalidStatus) {
  return (error, req, res, next) => { // eslint-disable-line no-unused-vars
    const isSizeError = Number(error?.httpCode) === 413
      || Number(error?.code) === 1009
      || /max(?:imum)?\s*file\s*size|too large/i.test(String(error?.message || ''));
    const status = isSizeError ? sizeStatus : invalidStatus;
    return redirectTo(res, `${pathname}?status=${encodeURIComponent(status)}`);
  };
}

function safeguardingEmptyMultipartErrorRedirect(error, req, res, next) { // eslint-disable-line no-unused-vars
  const status = String(req.originalUrl || req.url || '').includes('/vetting-review')
    ? 'vetting-review-evidence-prohibited'
    : 'safeguarding-policy-review-failed';
  return redirectTo(res, `/profile/settings?status=${status}#safeguarding`);
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

// Retired pre-Laravel paths are deliberately absent from the member routers.
// Keep their 404 contract ahead of module-level authentication so an obsolete
// URL is not mistaken for a valid page that merely needs a login.
function renderLegacyNotFound(req, res) {
  return res.status(404).render('errors/404', { title: 'Page not found' });
}

app.get('/listings/:id(\\d+)/delete', renderLegacyNotFound);
app.get(['/feed/new', '/feed/:id(\\d+)', '/feed/:id(\\d+)/edit'], renderLegacyNotFound);
app.post([
  '/feed/new',
  '/feed/:id(\\d+)/edit',
  '/feed/:id(\\d+)/delete',
  '/feed/:id(\\d+)/like',
  '/feed/:id(\\d+)/unlike',
  '/feed/:id(\\d+)/comments',
  '/feed/:id(\\d+)/comments/:commentId(\\d+)/delete'
], renderLegacyNotFound);
app.get('/events/my', renderLegacyNotFound);
app.post('/events/:id(\\d+)/rsvp/remove', renderLegacyNotFound);
app.post('/members/:id(\\d+)/connect', renderLegacyNotFound);

// Protected routes with CSRF and rate limiting
app.use('/dashboard', doubleCsrfProtection, dashboardRoutes);
app.use('/listings', doubleCsrfProtection, postOnly(formLimiter), listingsRoutes);
app.use('/profile', doubleCsrfProtection, profileRoutes);
app.use('/activity', doubleCsrfProtection, activityRoutes);
app.use('/wallet', doubleCsrfProtection, postOnly(walletLimiter), walletRoutes);
app.use('/messages', doubleCsrfProtection, postOnly(formLimiter), messagesRoutes);
app.use('/podcasts', doubleCsrfProtection, postOnly(formLimiter), podcastActionRoutes);
app.use('/connections', doubleCsrfProtection, postOnly(formLimiter), connectionsRoutes);
app.use('/members', requireAuth, doubleCsrfProtection, membersRoutes);
app.use('/notifications', doubleCsrfProtection, notificationsRoutes);
app.use('/settings', doubleCsrfProtection, settingsRoutes);
app.use('/groups', doubleCsrfProtection, postOnly(formLimiter), groupsRoutes);
app.use('/events', requireAuth, doubleCsrfProtection, postOnly(formLimiter), eventsRoutes);
app.use('/event-templates', doubleCsrfProtection, postOnly(formLimiter), eventTemplateRoutes);
app.use('/marketplace', doubleCsrfProtection, postOnly(formLimiter), marketplaceActionRoutes);
app.use('/volunteering', requireAuth, doubleCsrfProtection, postOnly(formLimiter), volunteeringActionRoutes);
app.use('/feed', doubleCsrfProtection, postOnly(formLimiter), feedActionRoutes);
app.use('/feed', doubleCsrfProtection, postOnly(formLimiter), feedRoutes);
app.use('/matches', doubleCsrfProtection, postOnly(formLimiter), matchesRoutes);
app.use('/achievements', doubleCsrfProtection, postOnly(formLimiter), achievementsRoutes);
app.use('/leaderboard', doubleCsrfProtection, leaderboardRoutes);
app.use('/nexus-score', doubleCsrfProtection, nexusScoreRoutes);
app.use('/onboarding', doubleCsrfProtection, postOnly(formLimiter), onboardingPostRoutes);
app.use('/me/collections', doubleCsrfProtection, postOnly(formLimiter), savedCollectionRoutes);
app.use('/search', doubleCsrfProtection, searchRoutes);
app.use('/reviews', doubleCsrfProtection, postOnly(formLimiter), reviewsRoutes);
app.use('/federation', doubleCsrfProtection, postOnly(formLimiter), federationActionRoutes);
app.use(doubleCsrfProtection, postOnly(formLimiter), savedSocialRoutes);
app.use(laravelPrepRoutes);

// CSRF error handler (must be before 404 handler since 404 is a catch-all)
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN' || err.code === 'ERR_BAD_CSRF_TOKEN' || (err.message && err.message.includes('csrf'))) {
    return res.status(419).render('errors/419', { title: 'This page has expired' });
  }
  next(err);
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Page not found' });
});

// Error logging middleware
app.use(errorLogger);

// Final error handler
app.use(finalErrorHandler);

// Process-level error handlers to prevent silent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Only start listening if not in test mode
if (NODE_ENV !== 'test') {
  sessionStore.ready
    .then(() => {
      app.listen(PORT, () => {
        console.log(`NEXUS UK Frontend running at http://localhost:${PORT}`);
        console.log(`Environment: ${NODE_ENV}`);
      });
    })
    .catch((error) => {
      console.error('Unable to initialize the persistent session store:', error.message);
      process.exit(1);
    });
}

module.exports = app;
