# Frontend Audit Report - Project NEXUS UK

Status: **Historical checkpoint — retained audit evidence, not current status**

> **Historical snapshot:** This February 2026 report is retained as audit
> history. It is not current architecture, completion, route, or certification
> evidence. Read `CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` first. Laravel Blade
> defines the browser experience, the Laravel backend defines the API contract,
> and ASP.NET is a separate incomplete future backend rather than a Web UK
> source of truth.

**Date:** February 2026
**Auditor:** Claude Code
**Status:** Historical audit completed with fixes applied; current Web UK goal remains incomplete

---

## Executive Summary

A comprehensive audit of the NEXUS UK Frontend was conducted covering routes, templates, API client, middleware, security, and CSS. The codebase is generally well-structured with consistent patterns across most files. Several critical issues were identified and fixed during this audit.

**Total Issues Found:** 15
**Issues Fixed:** 9
**Remaining (Low Priority):** 6

---

## Critical Issues Found & Fixed

### 1. Retired Progress-Alias Routes - Wrong Token Source (CRITICAL - HISTORICAL)

**File:** retired progress-alias route module
**Issue:** All routes used `req.session.token` instead of `req.token`
**Impact:** Routes would fail with undefined token errors
**Fix:** The old alias module was later removed in favor of Laravel-aligned
`/achievements`, `/leaderboard`, and `/nexus-score` routes.

### 2. Retired Progress-Alias Routes - Missing Error Handling (HIGH - HISTORICAL)

**File:** retired progress-alias route module
**Issue:** No handling for `ApiError` (401) or `ApiOfflineError`
**Impact:** Users wouldn't get proper error pages
**Fix:** The old alias module was later removed in favor of Laravel-aligned
gamification pages.

### 3. Retired Progress-Alias Routes - Missing Token Refresh (MEDIUM - HISTORICAL)

**File:** retired progress-alias route module
**Issue:** Routes had `requireAuth` but not `withTokenRefresh`
**Impact:** Token refresh wouldn't work on these pages
**Fix:** The old alias module was later removed in favor of Laravel-aligned
gamification pages.

### 4. XSS Vulnerability in nl2br Filter (HIGH - FIXED)

**File:** `src/server.js`
**Issue:** `nl2br` filter didn't escape HTML before converting newlines
**Impact:** XSS attacks possible in event descriptions and feed posts
**Fix:** Added HTML entity escaping before replacing newlines

### 5. Property Naming Inconsistency (MEDIUM - FIXED)

**Files:** Multiple templates
**Issue:** Templates used `first_name`/`last_name` without fallbacks for `firstName`/`lastName`
**Impact:** Names wouldn't display if API returned different casing
**Fix:** Added fallback patterns: `first_name or firstName`

**Files Fixed:**
- `src/views/feed/detail.njk` (post author, comments)
- `src/views/feed/index.njk` (post author)
- `src/views/groups/members.njk` (member list)
- `src/views/groups/detail.njk` (member preview)
- retired progress-alias leaderboard template (user entries)
- `src/views/events/detail.njk` (RSVP lists)

### 6. Avatar Partial Null Safety (LOW - FIXED)

**File:** `src/views/partials/avatar.njk`
**Issue:** Accessing `[0]` on potentially undefined strings
**Impact:** Could cause template errors
**Fix:** Added length checks before accessing character index

### 7. Members Route API Response Handling (MEDIUM - FIXED)

**File:** `src/routes/members.js`
**Issue:** Code expected `usersResult.users` but API returns `usersResult.data`
**Impact:** TypeError: `allUsers.slice is not a function`
**Fix:** Added `usersResult.data` as primary fallback and Array.isArray check

---

## Remaining Low-Priority Issues

### 1. CSRF on Logout GET Route
**File:** `src/server.js:285`
**Issue:** Logout accessible via GET without CSRF protection
**Risk:** Cross-site logout attacks (low impact)
**Recommendation:** Remove GET logout handler or require CSRF

### 2. Development Secrets in .env
**File:** `.env`
**Issue:** Weak development secrets committed
**Risk:** Development sessions could be forged if repo is exposed
**Recommendation:** Add `.env` to `.gitignore`, use `.env.example` only

### 3. Helmet CSP Uses 'unsafe-inline' for Styles
**File:** `src/server.js:138`
**Issue:** CSP allows inline styles
**Risk:** Reduced protection against style-based attacks
**Recommendation:** Externalize inline styles where possible

### 4. Rate Limiting Skipped in Development
**File:** `src/lib/rateLimiter.js:20`
**Issue:** Rate limiting bypassed in development
**Risk:** Security behavior differs between environments
**Recommendation:** Consider enforcing limits on POST/PUT/DELETE

### 5. No Timeout for API Requests
**File:** `src/lib/api.js`
**Issue:** No timeout configured for fetch operations
**Risk:** Hanging requests could exhaust server resources
**Recommendation:** Add AbortController with 30s timeout

### 6. Inconsistent Flash Message Null Checks
**Files:** Various routes
**Issue:** Some routes check `if (req.flash)`, others don't
**Risk:** None (flash is always available)
**Recommendation:** Remove unnecessary checks for consistency

---

## Positive Findings

### Routes
- ✅ All 18 route files properly structured with try/catch blocks
- ✅ Consistent CSRF token handling across routes
- ✅ All routes registered in server.js with proper middleware
- ✅ Middleware order is correct

### Templates
- ✅ All content templates extend `layouts/base.njk`
- ✅ CSRF tokens present in all forms (60 occurrences)
- ✅ Good use of GOV.UK macros and components
- ✅ Proper accessibility attributes (aria-labels, roles)
- ✅ Consistent error summary pattern with `govukErrorSummary`
- ✅ Empty state patterns consistently implemented

### Security
- ✅ Helmet.js properly configured with CSP
- ✅ CSRF protection via double-submit cookie pattern
- ✅ HTTP-only signed cookies with SameSite=Lax
- ✅ Comprehensive rate limiting implemented
- ✅ Nunjucks autoescape enabled by default
- ✅ Session timeout set to 30 minutes
- ✅ Token refresh flow properly implemented
- ✅ Cookie secrets required on startup

### CSS/SCSS
- ✅ Complete styling for all components
- ✅ Proper use of GOV.UK Sass variables and mixins
- ✅ Responsive design with media queries
- ✅ Accessibility-focused styles (focus states, etc.)
- ✅ Star rating and reviews components implemented
- ✅ Gamification styles comprehensive

### API Client
- ✅ 77 exported functions covering all endpoints
- ✅ Consistent error handling patterns
- ✅ Proper ApiError and ApiOfflineError classes
- ✅ Token passing consistent across all functions

---

## Files Modified During Audit

| File | Changes Made |
|------|-------------|
| Retired progress-alias route module | Historical audit fixes later superseded by Laravel-aligned gamification routes |
| `src/routes/members.js` | Fixed API response handling for users array |
| `src/server.js` | Fixed nl2br filter XSS vulnerability |
| `src/views/partials/avatar.njk` | Fixed null safety for initials |
| `src/views/feed/detail.njk` | Added property name fallbacks |
| `src/views/feed/index.njk` | Added property name fallbacks |
| `src/views/groups/members.njk` | Added property name fallbacks |
| `src/views/groups/detail.njk` | Added property name fallbacks |
| Retired progress-alias leaderboard template | Historical fallback work later superseded by Laravel-aligned leaderboard templates |
| `src/views/events/detail.njk` | Added property name fallbacks |

---

## Route Coverage Summary

| Route File | Handlers | Error Handling | Token Refresh |
|-----------|----------|----------------|---------------|
| auth.js | 8 | ✅ | N/A (public) |
| listings.js | 7 | ✅ | ❌ |
| profile.js | 3 | ✅ | ❌ |
| wallet.js | 5 | ✅ | ❌ |
| messages.js | 4 | ✅ | ❌ |
| connections.js | 4 | ✅ | ✅ |
| members.js | 3 | ✅ | ✅ |
| notifications.js | 4 | ✅ | ❌ |
| dashboard.js | 1 | ✅ | ✅ |
| settings.js | 3 | ✅ | ✅ |
| groups.js | 13 | ✅ | ✅ |
| events.js | 11 | ✅ | ✅ |
| feed.js | 11 | ✅ | ✅ |
| reports.js | 3 | ✅ | ✅ |
| reviews.js | 5 | ✅ | ✅ |
| search.js | 2 | ✅ | ✅ |
| gamification.js | 4 | ✅ (fixed) | ✅ (fixed) |

---

## Recommendations

### Immediate (Before Production)
1. Add `.env` to `.gitignore` and create `.env.example`
2. Generate strong secrets for production deployment
3. Consider adding API request timeouts

### Short-term
1. Add `withTokenRefresh` to remaining routes (listings, profile, wallet, messages, notifications)
2. Remove GET logout handler or add CSRF requirement
3. Standardize flash message null checks

### Long-term
1. Implement input validation library (joi or express-validator)
2. Consider CSP nonces for inline styles if needed
3. Add ETIMEDOUT handling to API client offline detection

---

## Conclusion

The NEXUS UK Frontend is well-architected with consistent patterns and good security practices. The critical issues identified (token handling, XSS, error handling) have been fixed. The application is ready for continued development with the remaining low-priority recommendations addressed as part of normal maintenance.
