// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SafeguardingHelp — collapsible guidance panel for the Safeguarding dashboard.
 *
 * Rendered at the foot of each broker safeguarding page. Focused on the member
 * protection flow — how members are flagged, what activates, the adult-autonomy
 * principle, and audit access.
 *
 * Companion to BrokerControlsHelp, which covers the broader operational flow
 * under /broker. Keep the two synchronised if the underlying
 * system behaviour changes.
 */


import { Separator } from '@/components/ui';
import BookOpen from 'lucide-react/icons/book-open';
import Clock from 'lucide-react/icons/clock';
import Eye from 'lucide-react/icons/eye';
import FileText from 'lucide-react/icons/file-text';
import Flag from 'lucide-react/icons/flag';
import Scale from 'lucide-react/icons/scale';
import Shield from 'lucide-react/icons/shield';
import UserCheck from 'lucide-react/icons/user-check';
import Users from 'lucide-react/icons/users';
import Zap from 'lucide-react/icons/zap';
import { useTranslation } from 'react-i18next';

import { Accordion, AccordionItem, Card, CardBody, CardHeader, Chip, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';

export function SafeguardingHelp() {
  const { t } = useTranslation('admin_safeguarding');
  const triggerRows = [
    {
      key: 'requires_broker_approval',
      effect: t('safeguarding.help.triggers.effects.requires_broker_approval'),
    },
    {
      key: 'restricts_messaging',
      effect: t('safeguarding.help.triggers.effects.restricts_messaging'),
    },
    {
      key: 'restricts_matching',
      effect: t('safeguarding.help.triggers.effects.restricts_matching'),
    },
    {
      key: 'requires_vetted_interaction',
      effect: t('safeguarding.help.triggers.effects.requires_vetted_interaction'),
    },
    {
      key: 'notify_admin_on_selection',
      effect: t('safeguarding.help.triggers.effects.notify_admin_on_selection'),
    },
    {
      key: 'vetting_type_required',
      effect: t('safeguarding.help.triggers.effects.vetting_type_required'),
    },
  ];

  return (
    <section className="mt-10">
      <Card  className="border border-border">
        <CardHeader className="flex items-center gap-3 pb-2">
          <div className="p-2 rounded-lg bg-accent/10">
            <BookOpen className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {t('safeguarding.help.title')}
            </h2>
            <p className="text-xs text-muted">
              {t('safeguarding.help.subtitle')}
            </p>
          </div>
        </CardHeader>
        <Separator />
        <CardBody className="pt-4">
          <Accordion variant="splitted" selectionMode="multiple">
            {/* ─────────────────────────────────────────────────────────────── */}
            <AccordionItem
              key="about" id="about"
              aria-label={t('safeguarding.help.about.aria')}
              title={
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-accent" />
                  <span className="font-medium">{t('safeguarding.help.about.title')}</span>
                </div>
              }
            >
              <div className="text-sm leading-relaxed text-foreground dark:text-muted space-y-3">
                <p>
                  {t('safeguarding.help.about.intro')}
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>{t('safeguarding.help.about.flagged_messages_label')}</strong> {t('safeguarding.help.about.flagged_messages_body')}</li>
                  <li><strong>{t('safeguarding.help.about.guardian_assignments_label')}</strong> {t('safeguarding.help.about.guardian_assignments_body')}</li>
                  <li><strong>{t('safeguarding.help.about.member_preferences_label')}</strong> {t('safeguarding.help.about.member_preferences_body')}</li>
                </ul>
                <p>
                  {t('safeguarding.help.about.live_counts')}
                </p>
              </div>
            </AccordionItem>

            {/* ─────────────────────────────────────────────────────────────── */}
            <AccordionItem
              key="flagging" id="flagging"
              aria-label={t('safeguarding.help.flagging.aria')}
              title={
                <div className="flex items-center gap-2">
                  <Flag className="w-4 h-4 text-danger" />
                  <span className="font-medium">{t('safeguarding.help.flagging.title')}</span>
                </div>
              }
            >
              <div className="text-sm leading-relaxed text-foreground dark:text-muted space-y-3">
                <p>
                  {t('safeguarding.help.flagging.intro')}
                </p>
                <div className="p-3 rounded-lg bg-accent/5 border border-accent/20">
                  <p className="font-medium text-foreground mb-1">
                    <Chip size="sm" variant="soft" className="mr-2">
                      {t('safeguarding.help.flagging.most_common')}
                    </Chip>
                    {t('safeguarding.help.flagging.self_identification_title')}
                  </p>
                  <p>
                    {t('safeguarding.help.flagging.self_identification_prefix')} <em>{t('safeguarding.help.flagging.example_vulnerable')}</em>, {t('safeguarding.help.flagging.or')}{' '}
                    <em>{t('safeguarding.help.flagging.example_vetted')}</em>. {t('safeguarding.help.flagging.self_identification_suffix')}{' '}
                    {/* eslint-disable-next-line i18next/no-literal-string -- Database table name must remain verbatim. */}
                    <code>user_messaging_restrictions</code>.
                  </p>
                  <p className="italic mt-2">
                    {t('safeguarding.help.flagging.self_revoke_prefix')} <em>{t('safeguarding.help.flagging.settings_safeguarding')}</em> {t('safeguarding.help.flagging.self_revoke_suffix')}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-warning/5 border border-warning/20">
                  <p className="font-medium text-foreground mb-1">
                    <Chip size="sm" color="warning" variant="soft" className="mr-2">
                      {t('safeguarding.help.flagging.admin_initiated')}
                    </Chip>
                    {t('safeguarding.help.flagging.manual_monitoring_title')}
                  </p>
                  <p>
                    {t('safeguarding.help.flagging.manual_monitoring_prefix')} <em>{t('safeguarding.help.flagging.user_monitoring')}</em> {t('safeguarding.help.flagging.manual_monitoring_suffix')}
                  </p>
                </div>
              </div>
            </AccordionItem>

            {/* ─────────────────────────────────────────────────────────────── */}
            <AccordionItem
              key="triggers" id="triggers"
              aria-label={t('safeguarding.help.triggers.aria')}
              title={
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-warning" />
                  <span className="font-medium">{t('safeguarding.help.triggers.title')}</span>
                </div>
              }
            >
              <div className="text-sm leading-relaxed text-foreground dark:text-muted space-y-3">
                <p>
                  {t('safeguarding.help.triggers.intro_prefix')} <em>{t('safeguarding.help.triggers.safeguarding_options')}</em> {t('safeguarding.help.triggers.intro_suffix')}
                </p>
                <Table aria-label={t('safeguarding.help.triggers.table_aria')} removeWrapper>
                  <TableHeader>
                    <TableColumn>{t('safeguarding.help.triggers.col_trigger_key')}</TableColumn>
                    <TableColumn>{t('safeguarding.help.triggers.col_effect')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {triggerRows.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell>
                          <code>{row.key}</code>
                        </TableCell>
                        <TableCell>{row.effect}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="italic text-muted">
                  {t('safeguarding.help.triggers.merge_note')}
                </p>
              </div>
            </AccordionItem>

            {/* ─────────────────────────────────────────────────────────────── */}
            <AccordionItem
              key="vetting-gate" id="vetting-gate"
              aria-label={t('safeguarding.help.vetting.aria')}
              title={
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-success" />
                  <span className="font-medium">{t('safeguarding.help.vetting.title')}</span>
                </div>
              }
            >
              <div className="text-sm leading-relaxed text-foreground dark:text-muted space-y-3">
                <p>
                  {t('safeguarding.help.vetting.intro_prefix')} <code>{'VETTING_REQUIRED'}</code> {t('safeguarding.help.vetting.intro_suffix')}
                </p>
                <ol className="list-decimal pl-5 space-y-2">
                  <li>
                    <strong>{t('safeguarding.help.vetting.discovery_label')}</strong> {t('safeguarding.help.vetting.discovery_body')}
                  </li>
                  <li>
                    <strong>{t('safeguarding.help.vetting.messaging_label')}</strong> {t('safeguarding.help.vetting.messaging_prefix')}
                    <code>{' MessageService::send'}</code> {t('safeguarding.help.vetting.messaging_middle')} <code>{'VETTING_REQUIRED'}</code> {t('safeguarding.help.vetting.messaging_suffix')}
                  </li>
                  <li>
                    <strong>{t('safeguarding.help.vetting.match_label')}</strong> {t('safeguarding.help.vetting.match_body')}
                  </li>
                  <li>
                    <strong>{t('safeguarding.help.vetting.group_label')}</strong> {t('safeguarding.help.vetting.group_body')}
                  </li>
                </ol>
                <p>
                  <strong>{t('safeguarding.help.vetting.staff_bypass_label')}</strong> {t('safeguarding.help.vetting.staff_bypass_body')}
                </p>
              </div>
            </AccordionItem>

            {/* ─────────────────────────────────────────────────────────────── */}
            <AccordionItem
              key="assignments" id="assignments"
              aria-label={t('safeguarding.help.assignments.aria')}
              title={
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-accent" />
                  <span className="font-medium">{t('safeguarding.help.assignments.title')}</span>
                </div>
              }
            >
              <div className="text-sm leading-relaxed text-foreground dark:text-muted space-y-3">
                <p>
                  {t('safeguarding.help.assignments.intro')}
                </p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>
                    <strong>{t('safeguarding.help.assignments.create_label')}</strong> {t('safeguarding.help.assignments.create_prefix')}
                    <em>{t('safeguarding.help.assignments.assign_guardian_path')}</em>. {t('safeguarding.help.assignments.create_suffix')}
                  </li>
                  <li>
                    <strong>{t('safeguarding.help.assignments.consent_label')}</strong> {t('safeguarding.help.assignments.consent_prefix')}
                    {/* eslint-disable-next-line i18next/no-literal-string -- Database column name must remain verbatim. */}
                    <code>consent_given_at</code>. {t('safeguarding.help.assignments.consent_middle')} <em>{t('safeguarding.help.assignments.active')}</em>
                    {t('safeguarding.help.assignments.consent_suffix')}
                  </li>
                  <li>
                    <strong>{t('safeguarding.help.assignments.revoke_label')}</strong> {t('safeguarding.help.assignments.revoke_prefix')}{' '}
                    {/* eslint-disable-next-line i18next/no-literal-string -- Database column name must remain verbatim. */}
                    <code>revoked_at</code>{t('safeguarding.help.assignments.revoke_suffix')}
                  </li>
                </ul>
                <p>
                  {t('safeguarding.help.assignments.queue_note')}
                </p>
              </div>
            </AccordionItem>

            {/* ─────────────────────────────────────────────────────────────── */}
            <AccordionItem
              key="member-preferences" id="member-preferences"
              aria-label={t('safeguarding.help.preferences.aria')}
              title={
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-accent" />
                  <span className="font-medium">{t('safeguarding.help.preferences.title')}</span>
                </div>
              }
            >
              <div className="text-sm leading-relaxed text-foreground dark:text-muted space-y-3">
                <p>
                  {t('safeguarding.help.preferences.intro_prefix')} <strong>{t('safeguarding.help.preferences.special_category')}</strong>
                  {t('safeguarding.help.preferences.intro_suffix')}
                </p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>{t('safeguarding.help.preferences.audit_logged')}</li>
                  <li>{t('safeguarding.help.preferences.not_public')}</li>
                  <li>{t('safeguarding.help.preferences.admin_only')}</li>
                  <li>{t('safeguarding.help.preferences.confidential')}</li>
                </ul>
                <p>
                  {t('safeguarding.help.preferences.activity_trail')}
                </p>
              </div>
            </AccordionItem>

            {/* ─────────────────────────────────────────────────────────────── */}
            <AccordionItem
              key="autonomy" id="autonomy"
              aria-label={t('safeguarding.help.autonomy.aria')}
              title={
                <div className="flex items-center gap-2">
                  <Scale className="w-4 h-4 text-success" />
                  <span className="font-medium">{t('safeguarding.help.autonomy.title')}</span>
                </div>
              }
            >
              <div className="text-sm leading-relaxed text-foreground dark:text-muted space-y-3">
                <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                  <p className="font-medium text-foreground mb-2">{t('safeguarding.help.autonomy.rule_label')}</p>
                  <p>
                    {t('safeguarding.help.autonomy.rule_prefix')} <em>{t('safeguarding.help.autonomy.and')}</em> {t('safeguarding.help.autonomy.rule_middle')}
                    <strong>{t('safeguarding.help.autonomy.cannot')}</strong> {t('safeguarding.help.autonomy.rule_suffix')}
                  </p>
                </div>
                <p>
                  {t('safeguarding.help.autonomy.grounded_prefix')} <strong>{t('safeguarding.help.autonomy.guidance')}</strong>
                  {t('safeguarding.help.autonomy.grounded_suffix')}
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('safeguarding.help.autonomy.trigger_reevaluation')}</li>
                  <li>{t('safeguarding.help.autonomy.admin_notification')}</li>
                  <li>
                    {t('safeguarding.help.autonomy.audit_log_prefix')}{' '}
                    {/* eslint-disable-next-line i18next/no-literal-string -- Audit query predicate must remain verbatim. */}
                    <code>action = 'safeguarding_consent_revoked'</code>.
                  </li>
                </ul>
                <p>
                  {t('safeguarding.help.autonomy.coercion_note')}
                </p>
              </div>
            </AccordionItem>

            {/* ─────────────────────────────────────────────────────────────── */}
            <AccordionItem
              key="annual-review" id="annual-review"
              aria-label={t('safeguarding.help.annual_review.aria')}
              title={
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-warning" />
                  <span className="font-medium">{t('safeguarding.help.annual_review.title')}</span>
                </div>
              }
            >
              <div className="text-sm leading-relaxed text-foreground dark:text-muted space-y-3">
                <p>
                  {t('safeguarding.help.annual_review.intro_prefix')}{' '}
                  {/* eslint-disable-next-line i18next/no-literal-string -- Scheduler command must remain verbatim. */}
                  <code>safeguarding:review-flags</code> {t('safeguarding.help.annual_review.intro_suffix')}
                </p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>
                    {t('safeguarding.help.annual_review.step_reminder')}{' '}
                    {/* eslint-disable-next-line i18next/no-literal-string -- Database column name must remain verbatim. */}
                    <code>review_reminder_sent_at</code>.
                  </li>
                  <li>{t('safeguarding.help.annual_review.step_wait')}</li>
                  <li>
                    {t('safeguarding.help.annual_review.step_escalate')}{' '}
                    {/* eslint-disable-next-line i18next/no-literal-string -- Database column name must remain verbatim. */}
                    <code>review_escalated_at</code>.
                  </li>
                </ol>
                <p>
                  <strong>{t('safeguarding.help.annual_review.flag_stays_active')}</strong> {t('safeguarding.help.annual_review.escalation_note')}
                </p>
                <p>
                  {t('safeguarding.help.annual_review.settings_prefix')} <em>{t('safeguarding.help.flagging.settings_safeguarding')}</em> {t('safeguarding.help.annual_review.settings_suffix')}
                  {/* eslint-disable-next-line i18next/no-literal-string -- Database column name must remain verbatim. */}
                  <code> review_confirmed_at</code> {t('safeguarding.help.annual_review.settings_tail')}
                </p>
              </div>
            </AccordionItem>

            {/* ─────────────────────────────────────────────────────────────── */}
            <AccordionItem
              key="audit" id="audit"
              aria-label={t('safeguarding.help.audit.aria')}
              title={
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-muted" />
                  <span className="font-medium">{t('safeguarding.help.audit.title')}</span>
                </div>
              }
            >
              <div className="text-sm leading-relaxed text-foreground dark:text-muted space-y-3">
                <p>
                  {t('safeguarding.help.audit.intro_prefix')}{' '}
                  {/* eslint-disable-next-line i18next/no-literal-string -- Database table name must remain verbatim. */}
                  <code>activity_log</code> {t('safeguarding.help.audit.intro_middle')}
                  {/* eslint-disable-next-line i18next/no-literal-string -- Audit query predicate must remain verbatim. */}
                  <code> action_type = 'safeguarding'</code>. {t('safeguarding.help.audit.intro_suffix')}
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>{t('safeguarding.help.audit.activity_log_label')}</strong> {t('safeguarding.help.audit.activity_log_body')}</li>
                  <li><strong>{t('safeguarding.help.audit.message_copies_label')}</strong> {t('safeguarding.help.audit.message_copies_body')}</li>
                  <li><strong>{t('safeguarding.help.audit.assignment_history_label')}</strong> {t('safeguarding.help.audit.assignment_history_body')}</li>
                </ul>
                <p>
                  {t('safeguarding.help.audit.export_prefix')} <em>{t('safeguarding.help.audit.export_csv')}</em> {t('safeguarding.help.audit.export_suffix')}
                </p>
              </div>
            </AccordionItem>
          </Accordion>
        </CardBody>
      </Card>
    </section>
  );
}

export default SafeguardingHelp;
