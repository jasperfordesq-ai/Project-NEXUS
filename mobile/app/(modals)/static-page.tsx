// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One of the community's public information pages, in the app.
 *
 * Serves About (`?key=about`), Contact (`?key=contact`) and Trust and safety
 * (`?key=trust-safety`) from `GET /v2/public-page-content/{pageKey}` — the same
 * content the website renders, not a summary of it.
 *
 * 🔴 The support screen previously showed a hand-written three-section summary
 * built from translation keys and offered "Open on the website" for the real
 * text. A member reading the app's own account of, say, trust and safety was
 * reading invented filler. Nothing on this screen is invented: every sentence
 * below the header comes from the server.
 *
 * 🔴 On Contact, the form posts to `POST /v2/contact` — the one endpoint that
 * enforces Cloudflare Turnstile. A native app cannot render that widget, so when
 * the server refuses with `TURNSTILE_FAILED` the member is pointed at their
 * community's own contact details instead of being shown a generic failure.
 */

import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Button as HeroButton, Card as HeroCard, TagGroup, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { Ionicons } from '@/components/ui/Icon';
import { ApiResponseError } from '@/lib/api/client';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  getStaticPageContent,
  isStaticPageKey,
  submitContactMessage,
  TURNSTILE_FAILED,
  type StaticPageContent,
  type StaticPageItem,
} from '@/lib/api/staticPages';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { contrastText, withAlpha } from '@/lib/utils/color';
import { toPlainText } from '@/lib/utils/plainText';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import TextArea from '@/components/ui/TextArea';

/** Enough of an address to be worth sending; the server validates properly. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function StaticPageRoute() {
  return (
    <ModalErrorBoundary>
      <StaticPageScreen />
    </ModalErrorBoundary>
  );
}

function StaticPageScreen() {
  const { t } = useTranslation(['profile', 'common']);
  const { key } = useLocalSearchParams<{ key?: string | string[] }>();
  const primary = usePrimaryColor();
  const theme = useTheme();

  const pageKey = normalizePageKey(key);
  const isKnownKey = pageKey !== '' && isStaticPageKey(pageKey);

  const { data, isLoading, error, refresh } = useApi(
    () => getStaticPageContent(pageKey),
    [pageKey],
    { enabled: isKnownKey },
  );

  const title = data?.title || t('profile:support.page.fallbackTitle');

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={title} backLabel={t('common:back')} fallbackHref="/(modals)/support" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 64, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            isKnownKey ? (
              <RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={primary} colors={[primary]} />
            ) : undefined
          }
        >
          {!isKnownKey ? (
            <EmptyState
              testID="static-page-unknown"
              icon="document-outline"
              title={t('profile:support.page.unknownTitle')}
              subtitle={t('profile:support.page.unknownSubtitle')}
            />
          ) : isLoading && !data ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorState
              testID="static-page-error"
              title={t('common:errors.loadFailedTitle')}
              subtitle={error}
              onRetry={refresh}
              retryLabel={t('common:buttons.retry')}
            />
          ) : !data ? (
            <EmptyState
              testID="static-page-empty"
              icon="document-outline"
              title={t('profile:support.page.emptyTitle')}
              subtitle={t('profile:support.page.emptySubtitle')}
            />
          ) : (
            <PageBody page={data} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PageBody({ page }: { page: StaticPageContent }) {
  const primary = usePrimaryColor();
  const theme = useTheme();

  return (
    <>
      <HeroCard className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.16) }}>
        <View className="h-1 w-full" style={{ backgroundColor: primary }} />
        <HeroCard.Body className="gap-2 p-4">
          <Text accessibilityRole="header" className="text-2xl font-bold" style={{ color: theme.text }}>
            {page.title}
          </Text>
          {page.lead ? (
            <Text className="text-base leading-6" style={{ color: theme.textSecondary }}>
              {toPlainText(page.lead)}
            </Text>
          ) : null}
        </HeroCard.Body>
      </HeroCard>

      {/*
        🔴 `contact_form` is skipped here on purpose. Its `items` ARE the subject
        options and its `body` repeats the page lead verbatim, so rendering it as
        prose put every subject on screen twice — once as a bullet and once as a
        chip in the picker below. `ContactPanel` is where that section belongs.
      */}
      {page.sections.filter((section) => section.key !== 'contact_form').map((section) => (
        <HeroCard
          key={section.key || section.title}
          className="overflow-hidden rounded-panel p-0"
          style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
        >
          <HeroCard.Body className="gap-3 p-4">
            {section.title ? (
              <Text accessibilityRole="header" className="text-lg font-bold" style={{ color: theme.text }}>
                {section.title}
              </Text>
            ) : null}
            {section.body ? (
              <Text className="text-base leading-6" style={{ color: theme.textSecondary }}>
                {toPlainText(section.body)}
              </Text>
            ) : null}
            {section.items.map((item, index) => (
              <SectionItem key={item.key ?? `${section.key}-${index}`} item={item} />
            ))}
          </HeroCard.Body>
        </HeroCard>
      ))}

      {page.page_key === 'contact' ? <ContactPanel page={page} /> : null}
    </>
  );
}

/**
 * One bullet inside a section.
 *
 * The server's item shape genuinely varies — `{ title, description }` for About's
 * steps, `{ key, description }` for Contact's subjects and Trust's lists — so
 * both are handled rather than one assumed.
 */
function SectionItem({ item }: { item: StaticPageItem }) {
  const theme = useTheme();
  const title = item.title?.trim() ?? '';
  const description = item.description?.trim() ?? '';

  if (!title && !description) return null;

  return (
    <View
      className="gap-1 rounded-panel-inner p-3"
      style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderSubtle }}
    >
      {title ? (
        <Text className="text-sm font-semibold" style={{ color: theme.text }}>
          {title}
        </Text>
      ) : null}
      {description ? (
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
          {toPlainText(description)}
        </Text>
      ) : null}
    </View>
  );
}

/** The community's own contact details, when it has published any. */
function ContactDetails() {
  const { t } = useTranslation(['profile']);
  const { tenant } = useTenant();
  const theme = useTheme();

  const rows = [
    { key: 'email', label: t('profile:support.contactForm.detailsEmail'), value: tenant?.contact?.email },
    { key: 'phone', label: t('profile:support.contactForm.detailsPhone'), value: tenant?.contact?.phone },
    { key: 'address', label: t('profile:support.contactForm.detailsAddress'), value: tenant?.contact?.address },
  ].filter((row) => typeof row.value === 'string' && row.value.trim() !== '');

  if (rows.length === 0) return null;

  return (
    <HeroCard
      testID="contact-details"
      className="overflow-hidden rounded-panel p-0"
      style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
    >
      <HeroCard.Body className="gap-2 p-4">
        <Text accessibilityRole="header" className="text-lg font-bold" style={{ color: theme.text }}>
          {t('profile:support.contactForm.detailsTitle')}
        </Text>
        {rows.map((row) => (
          <View key={row.key} className="gap-0.5">
            <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary, letterSpacing: 0.6 }}>
              {row.label}
            </Text>
            <Text selectable className="text-base leading-6" style={{ color: theme.text }}>
              {row.value}
            </Text>
          </View>
        ))}
      </HeroCard.Body>
    </HeroCard>
  );
}

function ContactPanel({ page }: { page: StaticPageContent }) {
  const { t } = useTranslation(['profile', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();

  /*
    The subject options are the server's own — the same list the website offers,
    from `govuk_alpha.contact.form.subjects`. Inventing a list here would let the
    app and the website disagree about what a member can ask about.
  */
  const subjects = useMemo(() => {
    const items = page.sections.flatMap((section) => (section.key === 'contact_form' ? section.items : []));
    return items
      .map((item, index) => ({
        id: item.key ?? String(index),
        label: (item.description ?? item.title ?? '').trim(),
      }))
      .filter((option) => option.label !== '');
  }, [page.sections]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [subjectId, setSubjectId] = useState<string>('');
  const [errors, setErrors] = useState<{ name?: string; email?: string; message?: string }>({});
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);

  useEffect(() => {
    setSubjectId((current) => (current || subjects[0]?.id) ?? '');
  }, [subjects]);

  async function submit() {
    const nextErrors: { name?: string; email?: string; message?: string } = {};
    if (!name.trim()) nextErrors.name = t('profile:support.contactForm.nameRequired');
    if (!EMAIL_PATTERN.test(email.trim())) nextErrors.email = t('profile:support.contactForm.emailRequired');
    if (!message.trim()) nextErrors.message = t('profile:support.contactForm.messageRequired');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const subject = subjects.find((option) => option.id === subjectId)?.label
      ?? subjects[0]?.label
      ?? t('profile:support.contactForm.subject');

    setIsSending(true);
    try {
      await submitContactMessage({ name, email, subject, message });
      setIsSent(true);
      setMessage('');
      showToast({
        title: t('profile:support.contactForm.successTitle'),
        description: t('profile:support.contactForm.successBody'),
        variant: 'success',
      });
    } catch (caught) {
      /*
        🔴 Matched on the CODE, never the message: the message is translated into
        the member's language, so matching on it would work in English only.
      */
      const isBotCheck = caught instanceof ApiResponseError && caught.code === TURNSTILE_FAILED;
      showToast({
        title: isBotCheck
          ? t('profile:support.contactForm.blockedTitle')
          : t('profile:support.contactForm.errorTitle'),
        description: isBotCheck
          ? t('profile:support.contactForm.blockedBody')
          : describeApiError(caught, t('profile:support.contactForm.errorBody')),
        variant: 'danger',
        duration: isBotCheck ? 'persistent' : undefined,
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <>
      <ContactDetails />

      <HeroCard
        testID="contact-form"
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        <HeroCard.Body className="gap-3 p-4">
          <Text accessibilityRole="header" className="text-lg font-bold" style={{ color: theme.text }}>
            {t('profile:support.contactForm.title')}
          </Text>

          {isSent ? (
            <View
              testID="contact-form-sent"
              className="flex-row items-start gap-3 rounded-panel-inner p-3"
              style={{ backgroundColor: withAlpha(theme.success, 0.12), borderWidth: 1, borderColor: withAlpha(theme.success, 0.24) }}
            >
              <Ionicons name="checkmark-circle-outline" size={20} color={theme.success} />
              <Text className="min-w-0 flex-1 text-sm leading-5" style={{ color: theme.text }}>
                {t('profile:support.contactForm.successBody')}
              </Text>
            </View>
          ) : null}

          {/* The visible <Label> is a sibling node in React Native, not a
              linked <label>, so each field carries its own accessible name. */}
          <Input
            label={t('profile:support.contactForm.name')}
            accessibilityLabel={t('profile:support.contactForm.name')}
            value={name}
            onChangeText={setName}
            error={errors.name}
            autoCapitalize="words"
            textContentType="name"
          />
          <Input
            label={t('profile:support.contactForm.email')}
            accessibilityLabel={t('profile:support.contactForm.email')}
            value={email}
            onChangeText={setEmail}
            error={errors.email}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="emailAddress"
          />

          {subjects.length > 0 ? (
            <View className="gap-1.5">
              <Text className="text-sm font-semibold" style={{ color: theme.text }}>
                {t('profile:support.contactForm.subject')}
              </Text>
              <TagGroup
                size="sm"
                selectionMode="single"
                selectedKeys={subjectId ? [subjectId] : []}
                onSelectionChange={(keys) => {
                  const next = Array.from(keys)[0];
                  if (next !== undefined) setSubjectId(String(next));
                }}
              >
                <TagGroup.List>
                  {subjects.map((option) => (
                    <TagGroup.Item key={option.id} id={option.id}>
                      <TagGroup.ItemLabel
                        style={option.id === subjectId ? { color: contrastText(primary) } : undefined}
                      >
                        {option.label}
                      </TagGroup.ItemLabel>
                    </TagGroup.Item>
                  ))}
                </TagGroup.List>
              </TagGroup>
            </View>
          ) : null}

          <TextArea
            label={t('profile:support.contactForm.message')}
            accessibilityLabel={t('profile:support.contactForm.message')}
            value={message}
            onChangeText={setMessage}
            error={errors.message}
            placeholder={t('profile:support.contactForm.messagePlaceholder')}
            multiline
            numberOfLines={6}
          />

          {/*
            No `backgroundColor` and no label colour here. The theme already
            paints a primary button in the community's colour and pairs it with
            `--accent-foreground`; overriding the background with
            `usePrimaryColor()` makes the two disagree in dark mode, where the
            accent is lightened. Guarded by `components/accentOverride.test.ts`.
          */}
          <HeroButton
            testID="contact-form-submit"
            accessibilityLabel={t('profile:support.contactForm.submit')}
            isDisabled={isSending}
            onPress={() => void submit()}
            className="min-h-11 rounded-full"
          >
            <HeroButton.Label className="text-sm font-semibold">
              {isSending ? t('profile:support.contactForm.sending') : t('profile:support.contactForm.submit')}
            </HeroButton.Label>
          </HeroButton>
        </HeroCard.Body>
      </HeroCard>
    </>
  );
}

function normalizePageKey(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? '').trim().toLowerCase();
}
