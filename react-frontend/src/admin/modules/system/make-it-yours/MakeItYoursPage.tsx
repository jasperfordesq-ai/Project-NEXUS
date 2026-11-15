// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin → "Make it yours" (warmth phase 6).
 *
 * One guided page for a community's own admin: the six things that make the
 * site look like THEIR community, in order, with what is done and what is
 * left. On 12 Nov 2026 only 4 of 14 live communities had chosen a colour and
 * none had a photo — the settings existed but sat in seven different menus.
 *
 * Nothing new is stored here. Logo, colour, look, Soft / Vivid and photo are
 * sections built for the Settings page and driven by the same form hook; since
 * 13 Nov 2026 they live here only (owner: one admin place per setting). The
 * accessible site's header colour followed on the same day: it sits under the
 * community colour in step 2, because both are saved by one call and an admin
 * choosing a colour should see where else it shows. "Light or dark to start
 * with" (15 Nov 2026) sits under it for the same reason: it is saved by that
 * same call, and it is the one new value here that IS stored — for someone who
 * has not chosen for themselves; a person's own choice always wins. The tagline saves through
 * the SEO endpoint that already owned it; themes and notices link to their
 * screens. Step 6 also shows the notice that is on the site now (15 Nov 2026),
 * because "Write a notice" alone did not say where one is taken down; it is
 * still changed and removed on the Announcements screen, never here.
 * Nothing changes for a community until its admin chooses it.
 *
 * One value IS stored from here (warmth phase 6, D4): the community's
 * optional founded date, which lives on this page alone. It is not a step and
 * never moves the meter; members see "{community} is three this month" on
 * their dashboard in the anniversary month.
 *
 * And one more (D1): the community's shared goal, set, changed and ended in
 * its own section (CommunityGoalSection). Also optional, also never a step.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ArrowRight from 'lucide-react/icons/arrow-right';
import CalendarHeart from 'lucide-react/icons/calendar-heart';
import ExternalLink from 'lucide-react/icons/external-link';
import Megaphone from 'lucide-react/icons/megaphone';
import Quote from 'lucide-react/icons/quote';
import Shapes from 'lucide-react/icons/shapes';
import Sparkles from 'lucide-react/icons/sparkles';
import { Alert, Button, Card, Chip, Input, Skeleton } from '@/components/ui';
import { useTenant, useToast } from '@/contexts';
import { SiteAnnouncementView } from '@/components/layout/SiteAnnouncementBanner';
import { logError } from '@/lib/logger';
import { currentAnnouncement } from '@/lib/siteAnnouncement';
import { useAdminPageMeta } from '../../../AdminMetaContext';
import { adminCommunitySetup, adminSettings, type CommunitySetupStepKey } from '../../../api/adminApi';
import { AdminSaveBar } from '../../../components/AdminSaveBar';
import { PageHeader } from '../../../components/PageHeader';
import { TAGLINE_MAX } from '../../../components/SeoChoiceFields';
import { useUnsavedChangesGuard } from '../../../components/useUnsavedChangesGuard';
import { SettingsSection } from '../settings/SettingsSection';
import { CommunityColourSection, communityColourTooLight } from '../settings/sections/CommunityColourSection';
import { CommunityPhotoSection } from '../settings/sections/CommunityPhotoSection';
import { DefaultThemeSection } from '../settings/sections/DefaultThemeSection';
import { HeaderColorsSection } from '../settings/sections/HeaderColorsSection';
import { HeaderLogoSection } from '../settings/sections/HeaderLogoSection';
import { useAdminSettingsForm } from '../settings/useAdminSettingsForm';
import { CommunityGoalSection } from './CommunityGoalSection';
import { AppIconSection } from './AppIconSection';
import { SetupProgress, setupStepAnchor } from './SetupProgress';
import { useCommunitySetup } from './useCommunitySetup';

/** The earliest founded date the server accepts. */
const FOUNDED_MIN = '1900-01-01';

/** Today's date on this device as YYYY-MM-DD. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The rule the server applies (CommunitySetupService::validFoundedOn): a real
 * YYYY-MM-DD date from 1 January 1900 up to today. Checked here too so a
 * date that would be refused is never sent.
 */
export function isValidFoundedOn(value: string, today: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  return value >= FOUNDED_MIN && value <= today;
}

/** A numbered step: its place in the walk, whether it is done, and the section itself. */
function SetupStep({
  stepKey,
  number,
  total,
  done,
  children,
}: {
  stepKey: CommunitySetupStepKey;
  number: number;
  total: number;
  done: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation('admin_system');

  return (
    <section
      id={setupStepAnchor(stepKey)}
      data-testid={`setup-step-${stepKey}`}
      data-done={done ? 'true' : 'false'}
      className="scroll-mt-24 space-y-2"
    >
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-sm font-medium text-muted">
          {t('admin_settings.miy_step_of', { number, total })}
        </span>
        <Chip size="sm" variant="soft" color={done ? 'success' : 'default'}>
          {done ? t('admin_settings.miy_done') : t('admin_settings.miy_to_do')}
        </Chip>
      </div>
      {children}
    </section>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <Card className="rounded-2xl border border-divider/70 bg-surface p-5">
        <Skeleton className="h-4 w-48 rounded" />
        <Skeleton className="mt-3 h-2 w-full rounded-full" />
      </Card>
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="rounded-2xl border border-divider/70 bg-surface p-5">
          <Skeleton className="h-4 w-40 rounded" />
          <Skeleton className="mt-3 h-10 w-full rounded-lg" />
        </Card>
      ))}
    </div>
  );
}

export function MakeItYoursPage() {
  const { t } = useTranslation('admin_system');
  const toast = useToast();
  const { tenant, branding, tenantPath, refreshTenant } = useTenant();
  useAdminPageMeta({ title: t('admin_settings.miy_title') });

  // Quiet refreshes: a save or an upload must not swap this long page for the
  // full-screen loading state and lose the admin's place.
  const general = useAdminSettingsForm({ quietRefresh: true });
  const setup = useCommunitySetup();
  const { status, refetch: refetchSetup } = setup;

  const [tagline, setTagline] = useState('');
  const [savedTagline, setSavedTagline] = useState('');
  const [savingTagline, setSavingTagline] = useState(false);
  const [savingColour, setSavingColour] = useState(false);
  // The placeholders are for the first load only. A save reads the settings
  // and the steps again; swapping the page for placeholders then would lose
  // the admin's place and flash the whole screen.
  const [ready, setReady] = useState(false);

  const [founded, setFounded] = useState('');
  const [savedFounded, setSavedFounded] = useState('');
  const [savingFounded, setSavingFounded] = useState(false);
  // The shared goal (warmth phase 6, D1) keeps its own form; the page only
  // needs to know whether it holds unsaved changes.
  const [goalDirty, setGoalDirty] = useState(false);

  // The founded date follows the server's copy until the admin changes it.
  useEffect(() => {
    if (status && founded === savedFounded) {
      setFounded(status.founded_on ?? '');
      setSavedFounded(status.founded_on ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the server's copy changes
  }, [status?.founded_on]);

  // The tagline box follows the server's copy until the admin types in it.
  useEffect(() => {
    if (status && tagline === savedTagline) {
      setTagline(status.tagline);
      setSavedTagline(status.tagline);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the server's copy changes
  }, [status?.tagline]);

  // A logo or photo upload saves at once and refreshes the tenant; read the
  // steps again so the tick appears and the logo's colours are offered.
  useEffect(() => {
    void refetchSetup();
  }, [branding.logo, branding.communityPhoto, refetchSetup]);

  const taglineDirty = tagline.trim() !== savedTagline.trim();
  const foundedDirty = founded.trim() !== savedFounded;
  useUnsavedChangesGuard((general.dirty || taglineDirty || foundedDirty || goalDirty) && !savingColour && !savingTagline && !savingFounded);

  const saveColour = useCallback(async () => {
    setSavingColour(true);
    try {
      const res = await general.saveHeaderColors();
      if (!res.ok) {
        // admin-i18n-ignore: already translated — useAdminSettingsForm returns the
        // AdminConfigController __() refusal or its own t() fallback.
        toast.error(res.error ?? t('system.save_failed'));
        return;
      }
      toast.success(t('admin_settings.miy_colour_saved'));
      await general.refetch();
      await refreshTenant({ silent: true });
      await refetchSetup();
    } finally {
      setSavingColour(false);
    }
  }, [general, refreshTenant, refetchSetup, toast, t]);

  const saveTagline = useCallback(async () => {
    setSavingTagline(true);
    try {
      const next = tagline.trim();
      const res = await adminSettings.updateSeoSettings({ tenant_tagline: next });
      if (!res.success) {
        // admin-i18n-ignore: localized server message — TenantSeoFields refusals are __() keys.
        toast.error(res.error || t('system.save_failed'));
        return;
      }
      setSavedTagline(next);
      setTagline(next);
      toast.success(t('admin_settings.miy_tagline_saved'));
      await refreshTenant({ silent: true });
      await refetchSetup();
    } catch (err) {
      logError('Tagline save error', err);
      toast.error(t('system.failed_to_save_settings'));
    } finally {
      setSavingTagline(false);
    }
  }, [tagline, refreshTenant, refetchSetup, toast, t]);

  const saveFounded = useCallback(async (next: string | null) => {
    setSavingFounded(true);
    try {
      const res = await adminCommunitySetup.updateFounded(next);
      if (!res.success) {
        // admin-i18n-ignore: localized server message — CommunitySetupController refusals are __() keys.
        toast.error(res.error || t('system.save_failed'));
        return;
      }
      setSavedFounded(next ?? '');
      setFounded(next ?? '');
      toast.success(next === null ? t('admin_settings.miy_founded_cleared') : t('admin_settings.miy_founded_saved'));
      await refetchSetup();
    } catch (err) {
      logError('Founded date save error', err);
      toast.error(t('system.failed_to_save_settings'));
    } finally {
      setSavingFounded(false);
    }
  }, [refetchSetup, toast, t]);

  const today = localToday();
  const foundedInvalid = founded.trim() !== '' && !isValidFoundedOn(founded.trim(), today);

  // Step 6: the notice members see now. Checked with the member website's own
  // reader, so a notice past its end time, or with an unsafe link, is shown
  // here exactly as it would be there (not at all, or without the link).
  const noticeShowing = useMemo(() => currentAnnouncement(status?.notice?.showing ?? null), [status?.notice?.showing]);
  const noticesSaved = status?.notice?.total ?? 0;

  const done = (key: CommunitySetupStepKey) => status?.steps.find((s) => s.key === key)?.done ?? false;
  const total = status?.total ?? 6;
  const complete = status !== null && status.done >= status.total;
  const name = tenant?.name || t('system.your_community');
  useEffect(() => {
    if (!general.loading && status !== null) setReady(true);
  }, [general.loading, status]);

  const colourBlocked = communityColourTooLight(general.form.community_color)
    ? t('admin_settings.community_colour_too_light')
    : null;

  return (
    <div className="pb-24">
      <PageHeader
        icon={<Sparkles size={20} aria-hidden="true" />}
        title={t('admin_settings.miy_title')}
        description={t('admin_settings.miy_intro', { name })}
        actions={
          <Button
            as="a"
            href={tenantPath('/')}
            target="_blank"
            rel="noopener noreferrer"
            size="sm"
            variant="secondary"
            endContent={<ExternalLink size={14} aria-hidden="true" />}
          >
            {t('admin_settings.miy_see_site')}
          </Button>
        }
      />

      {!ready || status === null ? (
        setup.failed ? (
          <Alert color="danger" title={t('admin_settings.miy_load_failed')} />
        ) : (
          <PageSkeleton />
        )
      ) : (
        <div className="space-y-8">
          <Card className="rounded-2xl border border-divider/70 bg-surface p-4 shadow-sm shadow-black/[0.03] sm:p-5">
            <SetupProgress status={status} showSteps />
            {complete && (
              <Alert color="success" className="mt-4" title={t('admin_settings.miy_all_done', { name })} />
            )}
          </Card>

          <SetupStep stepKey="logo" number={1} total={total} done={done('logo')}>
            <HeaderLogoSection state={general} />
          </SetupStep>

          <SetupStep stepKey="colour" number={2} total={total} done={done('colour')}>
            <CommunityColourSection state={general} logoColours={status.suggested_colours} />
            {/* Not a step of its own: the step is done when the community
                colour is chosen. It is here because the accessible site's
                header takes its line from that colour unless one is set. */}
            <div className="pt-4">
              <HeaderColorsSection state={general} />
            </div>
            {/* Not a step either, and never moves the meter: light or dark
                for someone who has not chosen for themselves. It is here
                because it is part of how the site looks and saves with the
                colour choices, in the same call. */}
            <div className="pt-4">
              <DefaultThemeSection state={general} />
            </div>
          </SetupStep>

          <SetupStep stepKey="photo" number={3} total={total} done={done('photo')}>
            <CommunityPhotoSection state={general} />
          </SetupStep>

          <SetupStep stepKey="tagline" number={4} total={total} done={done('tagline')}>
            <SettingsSection
              id="make-it-yours-tagline"
              icon={<Quote size={20} aria-hidden="true" />}
              title={t('admin_settings.miy_tagline_title')}
              description={t('admin_settings.miy_tagline_desc')}
            >
              <Input
                label={t('admin_settings.miy_tagline_label')}
                placeholder={t('admin_settings.miy_tagline_placeholder')}
                variant="secondary"
                value={tagline}
                maxLength={TAGLINE_MAX}
                onValueChange={setTagline}
                description={t('admin_settings.miy_tagline_count', { used: tagline.length, max: TAGLINE_MAX })}
              />
              <div>
                <Button
                  variant="primary"
                  size="sm"
                  isDisabled={!taglineDirty || savingTagline}
                  isLoading={savingTagline}
                  onPress={() => void saveTagline()}
                >
                  {t('admin_settings.miy_tagline_save')}
                </Button>
              </div>
            </SettingsSection>
          </SetupStep>

          <SetupStep stepKey="themes" number={5} total={total} done={done('themes')}>
            <SettingsSection
              id="make-it-yours-themes"
              icon={<Shapes size={20} aria-hidden="true" />}
              title={t('admin_settings.miy_themes_title')}
              description={t('admin_settings.miy_themes_desc')}
            >
              <p className="text-sm text-foreground" data-testid="setup-themes-count">
                {status.themes.total === 0
                  ? t('admin_settings.miy_themes_none')
                  : t('admin_settings.miy_themes_count', {
                      chosen: status.themes.with_picture,
                      total: status.themes.total,
                    })}
              </p>
              <div>
                <Button
                  as={Link}
                  to={tenantPath('/admin/categories')}
                  size="sm"
                  variant="secondary"
                  endContent={<ArrowRight size={14} aria-hidden="true" />}
                >
                  {t('admin_settings.miy_themes_open')}
                </Button>
              </div>
            </SettingsSection>
          </SetupStep>

          <SetupStep stepKey="notice" number={6} total={total} done={done('notice')}>
            <SettingsSection
              id="make-it-yours-notice"
              icon={<Megaphone size={20} aria-hidden="true" />}
              title={t('admin_settings.miy_notice_title')}
              description={t('admin_settings.miy_notice_desc')}
            >
              {/* The notice that is on the site now, as members see it, and the
                  way to take it down. Without this the only button read
                  "Write a notice", and nothing said that the same screen is
                  where a notice is removed for everyone. */}
              <div className="space-y-3">
                {noticeShowing ? (
                  <>
                    <p className="text-sm font-medium text-foreground">{t('admin_settings.miy_notice_showing')}</p>
                    <div className="overflow-hidden rounded-xl border border-divider">
                      <SiteAnnouncementView announcement={noticeShowing} linkPath={tenantPath} />
                    </div>
                    <p className="text-sm text-muted">{t('admin_settings.miy_notice_showing_hint')}</p>
                  </>
                ) : noticesSaved > 0 ? (
                  <p className="text-sm text-muted">{t('admin_settings.miy_notice_none_showing')}</p>
                ) : null}
                <div>
                  <Button
                    as={Link}
                    to={tenantPath('/admin/announcements')}
                    size="sm"
                    variant="secondary"
                    endContent={<ArrowRight size={14} aria-hidden="true" />}
                  >
                    {noticeShowing
                      ? t('admin_settings.miy_notice_manage')
                      : noticesSaved > 0
                        ? t('admin_settings.miy_notice_see_saved')
                        : t('admin_settings.miy_notice_open')}
                  </Button>
                </div>
              </div>
            </SettingsSection>
          </SetupStep>

          {/* Optional, and deliberately not a seventh step: a community that
              leaves it empty is not "unfinished", so it never moves the meter.
              It lives here only (one admin place per setting). */}
          <section
            id="make-it-yours-founded"
            data-testid="setup-founded"
            className="scroll-mt-24 space-y-2"
          >
            <div className="flex flex-wrap items-center gap-2 px-1">
              <Chip size="sm" variant="soft" color="default">
                {t('admin_settings.miy_founded_optional')}
              </Chip>
            </div>
            <SettingsSection
              id="make-it-yours-founded-date"
              icon={<CalendarHeart size={20} aria-hidden="true" />}
              title={t('admin_settings.miy_founded_title')}
              description={t('admin_settings.miy_founded_desc', { name })}
            >
              <Input
                type="date"
                label={t('admin_settings.miy_founded_label')}
                variant="secondary"
                value={founded}
                min={FOUNDED_MIN}
                max={today}
                onValueChange={setFounded}
                isInvalid={foundedInvalid}
                errorMessage={foundedInvalid ? t('admin_settings.miy_founded_invalid') : undefined}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  isDisabled={!foundedDirty || foundedInvalid || savingFounded}
                  isLoading={savingFounded}
                  onPress={() => void saveFounded(founded.trim() === '' ? null : founded.trim())}
                >
                  {t('admin_settings.miy_founded_save')}
                </Button>
                {savedFounded !== '' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    isDisabled={savingFounded}
                    onPress={() => void saveFounded(null)}
                  >
                    {t('admin_settings.miy_founded_clear')}
                  </Button>
                )}
              </div>
            </SettingsSection>
          </section>

          {/* The community's one shared goal (warmth phase 6, D1): optional,
              not a step, and set here alone. */}
          <CommunityGoalSection
            goal={status.community_goal ?? null}
            name={name}
            today={today}
            onChanged={refetchSetup}
            onDirtyChange={setGoalDirty}
          />

          {/* The community on the member's phone (warmth phase 6, A4): an
              optional square app icon. Not a step, so it never moves the
              meter; saves as it uploads, like the logo and photo. */}
          <section
            id="make-it-yours-app-icon"
            data-testid="setup-app-icon"
            className="scroll-mt-24 space-y-2"
          >
            <div className="flex flex-wrap items-center gap-2 px-1">
              <Chip size="sm" variant="soft" color="default">
                {t('admin_settings.miy_founded_optional')}
              </Chip>
            </div>
            <AppIconSection state={general} />
          </section>

          {/* The colour choices (community colour, look, Soft / Vivid and the
              accessible site's header colours) are the only ones here that
              wait for Save: logo and photo save as they upload, the tagline
              has its own button. So the bar is here only while one of them has
              changed — a permanent "All changes saved" bar across a guided
              page, covering the bottom of a phone screen, says nothing useful.
              Discard puts the colour choices back. */}
          {(general.dirty || savingColour) && (
            <AdminSaveBar
              dirty={general.dirty}
              saving={savingColour || general.saving}
              blockedReason={colourBlocked}
              onSave={() => void saveColour()}
              onDiscard={general.discard}
              saveLabel={t('admin_settings.miy_colour_save')}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default MakeItYoursPage;
