// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PHASE 4 — the caregiver-consent journey against BOTH backends, in one run.
 *
 * This is the instrument ADR-0004 condition 3 asks for: the same journey passing
 * against Laravel in the same execution as ASP.NET, so a fixture difference
 * cannot be mistaken for a backend fault.
 *
 * 🔴 THE REACT APP IS UNCHANGED BETWEEN THE ARMS.
 *
 * The only difference is `VITE_BACKEND_TARGET` on the dev server each arm talks
 * to. No page, component or hook branches on the backend, and nothing in this
 * file asks the frontend to behave differently — that is the whole point of the
 * condition, and adding such a branch to make an arm pass would void it.
 *
 * 🔴 WHAT IS COMPARED, AND WHAT IS DELIBERATELY NOT.
 *
 * ADR-0004 targets journey equivalence at CONSUMED boundaries. Fields are
 * compared against `CONSUMED_FIELDS`, derived from the React components rather
 * than from either backend's response — deriving it from a response would make
 * the check circular. A superset is not a gap. Row ids, timestamps, tenant ids
 * and account ids differ between the two fixtures BY DESIGN and are never
 * compared; what is compared is the OUTCOME: the stage a link reaches, who is
 * recorded as having done what, which refusals happen, and which notifications
 * are delivered.
 *
 * 🔴 THIS DOES NOT CERTIFY THE LEDGER ROW ON ITS OWN. Row 3.33 also covers
 * `/my-relationships` and `/my-trust-tier`, which this journey does not touch.
 * See the report accompanying this work; do not mark 3.33 CERTIFIED from here.
 *
 * 🔴 PREREQUISITE FOR THE BROWSER ARM — RAISE THE ASP.NET TOKEN LIFETIME.
 *
 * `aspnet-backend/compose.yml` sets `Jwt__TestAccessTokenExpirySeconds=5` with
 * zero clock skew. That is deliberate and correct: it is the control that lets
 * the token-expiry and refresh journeys be tested at all, and it must stay 5 in
 * the committed file.
 *
 * It makes a multi-step BROWSER journey impossible, and not in an obvious way.
 * The React app behaves properly — it notices the token is about to die and
 * raises a full-screen "Your session is about to expire" modal — so every click
 * after the first few seconds lands on that modal instead of the control under
 * test, and the failure reads as a broken selector. Raise it for the run with an
 * override file rather than editing the committed compose:
 *
 *     services:
 *       api:
 *         environment:
 *           - Jwt__TestAccessTokenExpirySeconds=3600
 *           - Jwt__TestClockSkewSeconds=30
 *
 *     docker compose -f compose.yml -f <that file> up -d api
 *
 * The API-level arm needs no such thing: `armApiAs` re-mints a token whenever the
 * current one is close to expiry, which is why the lifecycle test passes against
 * a five-second token and the browser test does not.
 */

import { test, expect } from '@playwright/test';
import {
  ARMS,
  ASPNET_ARM,
  CONSUMED_FIELDS,
  LARAVEL_ARM,
  type CaringArm,
  answerCaringOnboarding,
  armApiAs,
  armPage,
  armPath,
  assertArmLandedOn,
  assertBothArmsReachable,
  asRows,
  consumedShape,
  readLinkRow,
  readNotificationTypes,
  signInArm,
  unwrap
} from '../../helpers/caring-parity';

const today = () => new Date().toISOString().slice(0, 10);

/** Per-arm outcome record, compared across arms at the end. */
interface ArmOutcome {
  createStatus: number;
  createdStage: string;
  earlyApproveStatus: number;
  noAttestationStatus: number;
  selfConfirmRefused: boolean;
  confirmStatus: number;
  stageAfterConfirm: string;
  recipientConfirmedByIsRecipient: boolean;
  memberOnStaffQueueStatus: number;
  queueExposesConfirmation: boolean;
  approveStatus: number;
  stageAfterApprove: string;
  approvedByIsStaff: boolean;
  evidenceStored: boolean;
  scheduleActiveStatus: number;
  scheduleUnrelatedRefused: boolean;
  onBehalfStatus: number;
  rejectNoReasonStatus: number;
  rejectStatus: number;
  stageAfterReject: string;
  reasonPreserved: boolean;
  caregiverNotifications: string[];
  recipientNotifications: string[];
  consumedFieldGaps: Record<string, string[]>;
}

const outcomes = new Map<string, ArmOutcome>();

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await assertBothArmsReachable();
  for (const arm of ARMS) await signInArm(arm);
});

/**
 * The lifecycle, driven identically on each arm.
 *
 * Runs at the API boundary the React client itself calls, and asserts the effect
 * in that arm's own database. The BROWSER proof — the unchanged UI actually
 * driving these endpoints — is the separate test below; splitting them keeps the
 * comparison readable while still meeting conditions 1 and 2 between them.
 */
for (const arm of ARMS) {
  test(`[${arm.label}] the caregiver-consent lifecycle behaves the same way`, async () => {
    const { caregiver, recipient, staff } = arm.actors;

    // Start clean for THIS arm's actors only.
    const existing = await armApiAs(arm, caregiver, 'GET', '/v2/caring-community/caregiver/links');
    for (const row of asRows(existing.json)) {
      if (row?.id) {
        await armApiAs(arm, caregiver, 'DELETE', `/v2/caring-community/caregiver/links/${row.id}`);
      }
    }

    // ---- propose -------------------------------------------------------
    const create = await armApiAs(arm, caregiver, 'POST', '/v2/caring-community/caregiver/links', {
        cared_for_id: recipient.userId,
        relationship_type: 'neighbour',
        start_date: today(),
        notes: 'paired certification run'
      });
    const created = unwrap<any>(create.json);
    const linkId = Number(created?.id ?? 0);
    expect(linkId, `[${arm.label}] no link id: ${create.text.slice(0, 300)}`).toBeGreaterThan(0);

    // ---- refusals BEFORE consent ---------------------------------------
    const early = await armApiAs(arm, staff, 'POST', `/v2/admin/caring-community/caregiver-links/${linkId}/approve`, { consent_verified: true, consent_evidence: 'premature approval attempt' });
    const noAttestation = await armApiAs(arm, staff, 'POST', `/v2/admin/caring-community/caregiver-links/${linkId}/approve`, { consent_evidence: 'evidence without attestation' });

    // ---- the recipient answers for themselves --------------------------
    const incoming = await armApiAs(arm, recipient, 'GET', '/v2/caring-community/caregiver/incoming-links');
    const incomingRows = asRows(incoming.json);

    const selfConfirm = await armApiAs(arm, caregiver, 'POST', `/v2/caring-community/caregiver/incoming-links/${linkId}/confirm`, {});
    const confirm = await armApiAs(arm, recipient, 'POST', `/v2/caring-community/caregiver/incoming-links/${linkId}/confirm`, {});
    const afterConfirm = readLinkRow(arm, linkId);

    // ---- staff queue ----------------------------------------------------
    const memberOnQueue = await armApiAs(arm, caregiver, 'GET', '/v2/admin/caring-community/caregiver-links?status=pending');
    const queue = await armApiAs(arm, staff, 'GET', '/v2/admin/caring-community/caregiver-links?status=pending');
    const queueRows = asRows(queue.json);
    const queueRow = queueRows.find((row) => Number(row?.id) === linkId);

    // ---- approve --------------------------------------------------------
    const evidence = 'Consent verified by telephone during the paired certification run.';
    const approve = await armApiAs(arm, staff, 'POST', `/v2/admin/caring-community/caregiver-links/${linkId}/approve`, { consent_verified: true, consent_evidence: evidence });
    const afterApprove = readLinkRow(arm, linkId);

    // ---- the authority an active link unlocks ---------------------------
    const scheduleOk = await armApiAs(arm, caregiver, 'GET', `/v2/caring-community/caregiver/schedule/${recipient.userId}`);
    const scheduleUnrelated = await armApiAs(arm, caregiver, 'GET', '/v2/caring-community/caregiver/schedule/999999');
    const onBehalf = await armApiAs(arm, caregiver, 'POST', '/v2/caring-community/caregiver/request-on-behalf', { cared_for_id: recipient.userId, title: 'Paired run on-behalf request' });

    // ---- rejection, on a second link ------------------------------------
    const second = await armApiAs(arm, caregiver, 'POST', '/v2/caring-community/caregiver/links', { cared_for_id: staff.userId, relationship_type: 'friend', start_date: today() });
    const secondId = Number(unwrap<any>(second.json)?.id ?? 0);
    expect(secondId, `[${arm.label}] could not create the rejection-path link`).toBeGreaterThan(0);

    const rejectNoReason = await armApiAs(arm, staff, 'POST', `/v2/admin/caring-community/caregiver-links/${secondId}/reject`, { reason: '' });
    const reject = await armApiAs(arm, staff, 'POST', `/v2/admin/caring-community/caregiver-links/${secondId}/reject`, { reason: 'Could not reach the member to verify consent' });
    const afterReject = readLinkRow(arm, secondId);

    // ---- consumed-field coverage ----------------------------------------
    const myLinks = await armApiAs(arm, caregiver, 'GET', '/v2/caring-community/caregiver/links');
    const myRow = asRows(myLinks.json)[0];

    outcomes.set(arm.key, {
      createStatus: create.status,
      createdStage: String(created?.status ?? ''),
      earlyApproveStatus: early.status,
      noAttestationStatus: noAttestation.status,
      selfConfirmRefused: selfConfirm.status >= 400,
      confirmStatus: confirm.status,
      stageAfterConfirm: String(afterConfirm?.status ?? ''),
      recipientConfirmedByIsRecipient:
        Number(afterConfirm?.recipient_confirmed_by) === recipient.userId,
      memberOnStaffQueueStatus: memberOnQueue.status,
      queueExposesConfirmation: Boolean(queueRow?.recipient_confirmed_at),
      approveStatus: approve.status,
      stageAfterApprove: String(afterApprove?.status ?? ''),
      approvedByIsStaff: Number(afterApprove?.approved_by) === staff.userId,
      evidenceStored: String(afterApprove?.consent_evidence ?? '').includes('telephone'),
      scheduleActiveStatus: scheduleOk.status,
      scheduleUnrelatedRefused: scheduleUnrelated.status >= 400,
      onBehalfStatus: onBehalf.status,
      rejectNoReasonStatus: rejectNoReason.status,
      rejectStatus: reject.status,
      stageAfterReject: String(afterReject?.status ?? ''),
      reasonPreserved: String(afterReject?.rejection_reason ?? '').includes('Could not reach'),
      caregiverNotifications: readNotificationTypes(arm, caregiver.userId!),
      recipientNotifications: readNotificationTypes(arm, recipient.userId!),
      consumedFieldGaps: {
        myLinks: consumedShape(myRow, CONSUMED_FIELDS.myLinks).missing,
        incomingLinks: consumedShape(incomingRows[0], CONSUMED_FIELDS.incomingLinks).missing,
        reviewQueue: consumedShape(queueRow, CONSUMED_FIELDS.reviewQueue).missing
      }
    });

    // Per-arm sanity, so a broken arm fails on its own terms and not only in the
    // comparison — where it would look like a parity defect.
    const o = outcomes.get(arm.key)!;
    expect(o.createdStage, `[${arm.label}] a new link must start pending`).toBe('pending');
    expect(o.stageAfterApprove, `[${arm.label}] approval must activate the link`).toBe('active');
    expect(o.stageAfterReject, `[${arm.label}] rejection must reject the link`).toBe('rejected');
  });
}

/**
 * The unchanged React UI, driving the journey against EACH backend.
 *
 * Condition 1 is "the unchanged client driving it through its own UI, by
 * configuration change only". That is what this asserts: the same pages, the
 * same controls, the same rendered stage — switched only by which dev server the
 * browser is pointed at.
 */
for (const arm of ARMS) {
  test(`[${arm.label}] the unchanged React UI renders the journey's states`, async ({ browser }, testInfo) => {
    const { context, page } = await armPage(browser, arm, arm.actors.caregiver);
    try {
      await page.goto(armPath(arm, '/caring-community'));
      await assertArmLandedOn(page, arm, /\/caring-community\/?$/, 'the Caring hub');
      await answerCaringOnboarding(page);

      // The module resolved rather than falling back to the feature-gate
      // placeholder — the same check on both arms, and on ASP.NET it also proves
      // the tenant bootstrap reports the flag under the spelling the app reads.
      await expect(
        page.locator('body'),
        `[${arm.label}] the Caring hub rendered the feature-disabled placeholder`
      ).not.toContainText(/coming soon/i);

      // The entry point this work changed: Caring, never volunteering.
      const become = page.locator('a[href$="/caring-community/caregiver/link"]');
      await expect(become, `[${arm.label}] "Become a caregiver" is missing`).toHaveCount(1);

      await page.goto(armPath(arm, '/caring-community/caregiver'));
      await assertArmLandedOn(page, arm, /\/caring-community\/caregiver\/?$/, 'the caregiver dashboard');
      await answerCaringOnboarding(page);

      // The active link created by the lifecycle test above must RENDER as
      // active — a stage the component derives from `status`, so this proves the
      // backend's value reaches the UI in the shape the component reads.
      await expect(
        page.getByText('Active', { exact: true }).first(),
        `[${arm.label}] the approved relationship is not shown as active`
      ).toBeVisible({ timeout: 20_000 });

      await testInfo.attach(`${arm.key}-caregiver-dashboard.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png'
      });
    } finally {
      await context.close();
    }
  });
}

/**
 * The comparison itself.
 *
 * 🔴 Compares OUTCOMES, never identifiers. Row ids, account ids, tenant ids and
 * timestamps differ between the two fixtures by design; requiring them to match
 * would be comparing the seeds, not the backends.
 */
test('the two backends reach the same outcomes at every gate', async () => {
  const laravel = outcomes.get(LARAVEL_ARM.key);
  const aspnet = outcomes.get(ASPNET_ARM.key);
  expect(laravel, 'the Laravel control arm did not run').toBeTruthy();
  expect(aspnet, 'the ASP.NET arm did not run').toBeTruthy();

  const compare: Array<[keyof ArmOutcome, string]> = [
    ['createStatus', 'creating a caregiver link'],
    ['createdStage', 'the stage a new link starts at'],
    ['earlyApproveStatus', 'approving before the recipient has confirmed'],
    ['noAttestationStatus', 'approving without the explicit attestation'],
    ['selfConfirmRefused', 'the caregiver trying to confirm on the recipient’s behalf'],
    ['confirmStatus', 'the recipient confirming'],
    ['stageAfterConfirm', 'the stage after the recipient confirms'],
    ['recipientConfirmedByIsRecipient', 'who the confirmation is attributed to'],
    ['memberOnStaffQueueStatus', 'an ordinary member reaching the staff queue'],
    ['queueExposesConfirmation', 'the staff queue showing the confirmation state'],
    ['approveStatus', 'approving with evidence and attestation'],
    ['stageAfterApprove', 'the stage after approval'],
    ['approvedByIsStaff', 'who the approval is attributed to'],
    ['evidenceStored', 'the consent evidence being stored'],
    ['scheduleActiveStatus', 'the schedule for an active link'],
    ['scheduleUnrelatedRefused', 'the schedule for an unrelated member'],
    ['onBehalfStatus', 'raising an on-behalf request'],
    ['rejectNoReasonStatus', 'rejecting with no reason'],
    ['rejectStatus', 'rejecting with a reason'],
    ['stageAfterReject', 'the stage after rejection'],
    ['reasonPreserved', 'the rejection reason being preserved']
  ];

  const differences: string[] = [];
  for (const [field, description] of compare) {
    const l = laravel![field];
    const a = aspnet![field];
    if (JSON.stringify(l) !== JSON.stringify(a)) {
      differences.push(`${description}: Laravel=${JSON.stringify(l)} ASP.NET=${JSON.stringify(a)}`);
    }
  }

  // Notifications are compared as a SET of types. Ordering and counts can
  // legitimately differ (a retry, a digest), but a type delivered by one backend
  // and not the other means a participant is not told something.
  for (const who of ['caregiverNotifications', 'recipientNotifications'] as const) {
    const l = new Set(laravel![who]);
    const a = new Set(aspnet![who]);
    const onlyLaravel = [...l].filter((t) => !a.has(t));
    const onlyAspnet = [...a].filter((t) => !l.has(t));
    if (onlyLaravel.length || onlyAspnet.length) {
      differences.push(
        `${who}: only Laravel=${JSON.stringify(onlyLaravel)} only ASP.NET=${JSON.stringify(onlyAspnet)}`
      );
    }
  }

  expect(differences, 'the two backends behaved differently').toEqual([]);
});

test('ASP.NET returns every field the React components actually read', () => {
  const aspnet = outcomes.get(ASPNET_ARM.key)!;
  const laravel = outcomes.get(LARAVEL_ARM.key)!;

  // 🔴 A field MISSING from ASP.NET that a component reads is a defect however
  // obscure it looks. A field ASP.NET adds is not — a superset is allowed.
  for (const [surface, missing] of Object.entries(aspnet.consumedFieldGaps)) {
    expect(missing, `ASP.NET omits fields the React ${surface} view reads`).toEqual([]);
  }
  // The control must be clean too, or the manifest is simply wrong.
  for (const [surface, missing] of Object.entries(laravel.consumedFieldGaps)) {
    expect(missing, `Laravel omits fields the React ${surface} view reads — check CONSUMED_FIELDS`).toEqual([]);
  }
});

test.afterAll(() => {
  for (const arm of ARMS) {
    const o = outcomes.get(arm.key);
    if (!o) continue;
    console.log(
      `\n[${arm.label}] pending→confirm→approve = ${o.createdStage}→${o.stageAfterConfirm}→${o.stageAfterApprove}; `
        + `refusals ${o.earlyApproveStatus}/${o.noAttestationStatus}/${o.rejectNoReasonStatus}; `
        + `caregiver notified: ${[...new Set(o.caregiverNotifications)].join(', ') || 'none'}`
    );
  }
});
