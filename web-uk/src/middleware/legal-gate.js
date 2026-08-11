// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { ApiError, ApiOfflineError, getLegalAcceptanceStatus } = require('../lib/api');

/**
 * Show a signed-in member the acceptance page when they owe an acceptance.
 *
 * Laravel is the authority: `EnsureLegalAcceptance` is what actually refuses a
 * write, and its mode (`config/legal.php`) decides whether anything is enforced at
 * all. This is only the interstitial — it exists so that a blocked member sees a
 * page explaining what changed and a button, instead of a bare 403 from whatever
 * they were trying to do.
 *
 * 🔴 THE MODE IS NOW ACTUALLY READ. This docblock claimed it was, and it was not:
 * nothing here consulted the mode, so this gate redirected whenever a document was
 * pending. An installation deliberately running `report` — whose entire purpose is
 * "log who WOULD be blocked, block nobody, for a measurement week" — still had
 * every accessible-frontend member stopped before any page, and `off` did not mean
 * off. Found by audit on 2026-08-11, the same day it shipped.
 *
 * The fix is server-published, not duplicated here. `GET /v2/legal/acceptance/status`
 * now returns `enforcement_blocking`, computed by `EnsureLegalAcceptance::modeBlocks()`
 * — the same predicate the gate itself uses. Copying the mode table into JavaScript
 * would drift, and two gates disagreeing about who is blocked is worse than one
 * being wrong. When the server says it is not blocking, this stands down entirely.
 *
 * 🔴 Only an EXPLICIT `false` stands it down. An absent field keeps today's
 * behaviour, because the alternative — treating absence as "not blocking" — would
 * silently drop the acceptance prompt if that field ever failed to serialise, on an
 * obligation the owner deliberately enforces by default. React's `useLegalGate`
 * applies the identical test, so the two clients cannot disagree about who is
 * blocked. In practice absence cannot occur: web-uk calls its own colour's Laravel
 * container, so client and server ship from one commit.
 *
 * 🔴 FIVE independent loop-breakers, because an interstitial that can trap
 * somebody is worse than no interstitial at all. Any one of them failing must not
 * be enough to strand a member:
 *
 *   1. GET requests asking for HTML only. A POST is never intercepted — it would
 *      be silently discarded — and neither is a JSON or asset request.
 *   2. A PREFIX exempt list, not a last-segment match. React's own gate matches
 *      the LAST path segment, which is why `/terms/versions` was blocked there:
 *      a member could not read what had changed before agreeing to it. Matching
 *      `/legal` as a prefix covers every document, every version page and the
 *      comparison in one rule.
 *   3. Unauthenticated requests short-circuit before any API call, so a signed-out
 *      visitor can never be sent here and the public pages cost nothing.
 *   4. A 60-second session-cached verdict, cleared the moment the member accepts.
 *      Without the clear, accepting and being sent straight back here is exactly
 *      the loop this is meant to prevent.
 *   5. The server's own enforcement mode, above. If the platform is not refusing
 *      requests, this never interposes — so a misconfiguration here cannot block
 *      members that Laravel would have let through.
 *
 * 🔴 It also FAILS OPEN. If the status call errors or the API is unreachable, the
 * member continues to the page they asked for. Laravel still refuses the actual
 * write, so nothing is let through that matters — whereas failing closed here
 * would put an unavoidable wall in front of a member because a request timed out.
 */

/** Paths this must never intercept, matched as prefixes. */
const EXEMPT_PREFIXES = [
  // The documents themselves, their history, and the comparison — everything a
  // member needs in order to decide. `/legal` covers all of it.
  '/legal',
  // The acceptance page and its POST target.
  '/legal-acceptance',
  // Standalone document paths, which redirect into /legal.
  '/terms',
  '/privacy',
  '/cookies',
  '/accessibility',
  '/community-guidelines',
  '/acceptable-use',
  // Signing out must always work: "I do not accept" has to have an answer.
  '/logout',
  '/login',
  '/register',
  '/password',
  // Cookie choices are a separate consent and must not be held hostage to this
  // one.
  '/cookies-settings',
  '/cookie-consent',
  // Platform plumbing and static assets.
  '/health',
  '/service-unavailable',
  '/session',
  '/assets',
  '/css',
  '/js',
  '/uploads',
  '/downloads',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.json',
  '/service-worker.js'
];

const VERDICT_TTL_MS = 60 * 1000;

function isExempt(pathname) {
  const path = String(pathname || '/');

  return EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function wantsHtml(req) {
  const accept = String(req.headers.accept || '');
  // An empty Accept header is treated as a page request: some browsers omit it on
  // a plain navigation, and a member on one of those must still see the page.
  return accept === '' || accept.includes('text/html') || accept.includes('*/*');
}

function normalizeDocuments(payload) {
  const rows = Array.isArray(payload?.documents) ? payload.documents : [];

  return rows
    .filter((row) => row && row.acceptance_status !== 'current')
    .map((row) => ({
      documentId: row.document_id,
      type: String(row.document_type || ''),
      // Hyphenated, matching the public paths. The API returns the underscored
      // type, and no route matches that form.
      slug: String(row.document_type || '').replace(/_/g, '-'),
      title: String(row.title || ''),
      versionNumber: row.current_version ? String(row.current_version) : '',
      // 'not_accepted' means never seen; 'outdated' means it changed since they
      // agreed. Those deserve different labels — "Updated" on something a member
      // has never seen is simply wrong.
      isNew: row.acceptance_status === 'not_accepted'
    }));
}

/**
 * Read the verdict, using the session cache when it is fresh.
 *
 * Cached in the session rather than in memory so it survives across workers, and
 * for only a minute so a member who accepts in another tab is not held here.
 */
async function pendingDocumentsFor(req) {
  const now = Date.now();
  const cached = req.session?.legalGate;

  if (cached && typeof cached.checkedAt === 'number' && now - cached.checkedAt < VERDICT_TTL_MS) {
    return {
      documents: Array.isArray(cached.documents) ? cached.documents : [],
      // Matches the fresh-read rule below: only an explicit false stands down. A
      // cache written before this field existed has `undefined` and keeps
      // today's behaviour.
      blocking: cached.blocking !== false
    };
  }

  const result = await getLegalAcceptanceStatus(req.signedCookies.token);
  const payload = result?.data !== undefined ? result.data : result;
  const documents = payload?.has_pending === false ? [] : normalizeDocuments(payload);

  // 🔴 `!== false`, NOT `=== true`. Only an EXPLICIT false stands the gate down.
  //
  // The difference is what an absent field means, and the two clients must agree —
  // React's `useLegalGate` uses the identical test. An absent field means an older
  // backend, which in practice cannot happen: web-uk talks to its own colour's
  // Laravel container, so they ship from one commit. Choosing `!== false` means
  // that if the field ever fails to serialise, behaviour is exactly today's rather
  // than silently dropping the acceptance prompt on a legal obligation the owner
  // deliberately enforces by default.
  //
  // TWO independent conditions, and both come from the server:
  //   enforcement_blocking — is the platform refusing requests at all? (`off` and
  //                          `report` say no)
  //   blocking_pending     — is any pending document one it will actually refuse
  //                          over? A community can mark a document display-only via
  //                          `acceptance_required_for`, and this gate used to block
  //                          on it anyway while the API accepted the member's writes.
  const blocking = payload?.enforcement_blocking !== false
    && payload?.blocking_pending !== false;

  if (req.session) {
    req.session.legalGate = { checkedAt: now, documents, blocking };
  }

  return { documents, blocking };
}

/** Called after a successful accept, so the next request is not sent back here. */
function clearLegalGateCache(req) {
  if (req.session) {
    delete req.session.legalGate;
  }
}

function legalGate(req, res, next) {
  // (1) GET/HEAD asking for HTML only.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }
  if (!wantsHtml(req)) {
    return next();
  }

  // (2) Prefix exemptions.
  if (isExempt(req.path)) {
    return next();
  }

  // (3) Nothing to ask of somebody who is not signed in.
  if (!req.signedCookies?.token) {
    return next();
  }

  return pendingDocumentsFor(req)
    .then(({ documents, blocking }) => {
      // (5) The platform is not refusing requests — `off` or `report`. Nothing to
      // interpose. Under `report` Laravel is deliberately still counting who WOULD
      // be blocked; standing down here is what makes that count meaningful.
      if (!blocking) {
        return next();
      }

      if (documents.length === 0) {
        return next();
      }

      const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
      // The member returns to what they asked for once they have accepted. Only a
      // path, and it is re-validated on the way back out.
      const returnTo = req.originalUrl || req.url || '/';
      const target = `${urlFor('/legal-acceptance')}?return=${encodeURIComponent(returnTo)}`;

      return res.redirect(303, target);
    })
    .catch((error) => {
      // (4) Fail open. Laravel still refuses the write; an unreachable status
      // endpoint must not become an unavoidable wall.
      if (error instanceof ApiError || error instanceof ApiOfflineError) {
        return next();
      }
      return next();
    });
}

module.exports = { legalGate, clearLegalGateCache, normalizeDocuments, isExempt, VERDICT_TTL_MS };
