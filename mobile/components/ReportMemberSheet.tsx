// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Report a member, or a direct message received from one, to the community's coordinators.
 *
 * Opened from the member profile ("Report", beside Block) and from a received message's
 * actions in a conversation ("Report message"). The same six reasons, privacy line and
 * emergency line as the website's member report dialog.
 *
 * 🔴 409 `ALREADY_REPORTED` is an ANSWER, not a failure: it is shown as information, so a
 * member is never told their report did not go through when it already had.
 *
 * 🔴 The emergency line names no number: the platform is global, so a country-specific
 * number would be wrong for most communities.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import BottomSheet from '@/components/ui/BottomSheet';
import TextArea from '@/components/ui/TextArea';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Ionicons } from '@/components/ui/Icon';
import { ApiResponseError } from '@/lib/api/client';
import {
  MEMBER_REPORT_CATEGORIES,
  MEMBER_REPORT_DETAILS_MAX,
  memberReportDetailsProblem,
  reportMember,
  reportMessage,
  type MemberReportCategory,
} from '@/lib/api/memberReports';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

export interface ReportMemberTarget {
  type: 'member' | 'message';
  id: number;
}

interface ReportMemberSheetProps {
  visible: boolean;
  /** What is being reported; null while nothing is. */
  target: ReportMemberTarget | null;
  /** The member's display name, for the title. */
  subjectName: string;
  onClose: () => void;
}

type Outcome = { kind: 'sent' } | { kind: 'already'; message: string };

/** The server's own words for these refusals are written for a member; show them as they are. */
function serverMessage(error: unknown): string | null {
  if (!(error instanceof ApiResponseError)) return null;
  if (error.status >= 500) return null;
  const message = error.message?.trim();
  if (!message || message.length > 300 || message.includes('<')) return null;
  return message;
}

export default function ReportMemberSheet({ visible, target, subjectName, onClose }: ReportMemberSheetProps) {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const primary = usePrimaryColor();

  const [category, setCategory] = useState<MemberReportCategory | null>(null);
  const [details, setDetails] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const pending = useRef(false);

  const targetKey = target ? `${target.type}:${target.id}` : '';
  useEffect(() => {
    if (!visible) return;
    setCategory(null);
    setDetails('');
    setReasonError(null);
    setDetailsError(null);
    setFormError(null);
    setOutcome(null);
  }, [visible, targetKey]);

  const submit = useCallback(async () => {
    if (!target || pending.current) return;
    setFormError(null);
    if (!category) {
      setReasonError(t('memberReport.chooseReason'));
      return;
    }
    const problem = memberReportDetailsProblem(category, details);
    if (problem) {
      setDetailsError(problem === 'required'
        ? t('memberReport.detailsRequired')
        : t('memberReport.detailsTooLong', { max: MEMBER_REPORT_DETAILS_MAX }));
      return;
    }
    pending.current = true;
    setSubmitting(true);
    try {
      const input = { category, details: details.trim() };
      if (target.type === 'member') await reportMember(target.id, input);
      else await reportMessage(target.id, input);
      setOutcome({ kind: 'sent' });
    } catch (error) {
      const message = serverMessage(error);
      if (error instanceof ApiResponseError && error.status === 409) {
        setOutcome({ kind: 'already', message: message ?? t('memberReport.already') });
      } else if (error instanceof ApiResponseError && error.status === 422 && error.field === 'details') {
        setDetailsError(message ?? t('memberReport.detailsRequired'));
      } else if (error instanceof ApiResponseError && error.status === 422 && error.field === 'category') {
        setReasonError(message ?? t('memberReport.chooseReason'));
      } else {
        setFormError(message ?? t('memberReport.failed'));
      }
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }, [category, details, t, target]);

  const title = target?.type === 'message'
    ? t('memberReport.titleMessage', { name: subjectName })
    : t('memberReport.titleMember', { name: subjectName });

  return (
    <BottomSheet
      visible={visible && target !== null}
      onClose={onClose}
      title={title}
      scrollable
      dismissible={!submitting}
      testID="report-member-sheet"
    >
      {outcome ? (
        <View className="gap-4 pb-4 pt-2">
          <View className="flex-row items-start gap-3" accessibilityLiveRegion="polite">
            <Ionicons
              name={outcome.kind === 'sent' ? 'checkmark-circle-outline' : 'information-circle-outline'}
              size={22}
              color={outcome.kind === 'sent' ? theme.success : theme.info}
            />
            <Text className="flex-1 text-base leading-6" style={{ color: theme.text }}>
              {outcome.kind === 'sent' ? t('memberReport.sent') : outcome.message}
            </Text>
          </View>
          <HeroButton variant="secondary" onPress={onClose} testID="report-member-close">
            <HeroButton.Label>{t('memberReport.close')}</HeroButton.Label>
          </HeroButton>
        </View>
      ) : (
        <View className="gap-4 pb-4 pt-2">
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
            {t('memberReport.privacy')}
          </Text>

          <View accessibilityRole="radiogroup" accessibilityLabel={t('memberReport.reasonLabel')} className="gap-2">
            <Text className="text-sm font-semibold" style={{ color: theme.text }}>
              {t('memberReport.reasonLabel')}
            </Text>
            {MEMBER_REPORT_CATEGORIES.map((option) => {
              const checked = category === option;
              const label = t(`memberReport.reason.${option}`);
              const help = t(`memberReport.help.${option}`);
              return (
                <Pressable
                  key={option}
                  onPress={() => {
                    setCategory(option);
                    setReasonError(null);
                    setDetailsError(null);
                  }}
                  disabled={submitting}
                  accessibilityRole="radio"
                  accessibilityState={{ checked, disabled: submitting }}
                  accessibilityLabel={`${label}. ${help}`}
                  testID={`report-reason-${option}`}
                  className="flex-row items-start gap-3 rounded-xl px-3 py-3"
                  style={{
                    borderWidth: 1,
                    borderColor: checked ? primary : theme.border,
                    minHeight: 48,
                  }}
                >
                  <Ionicons
                    name={checked ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={checked ? primary : theme.textMuted}
                  />
                  <View className="flex-1 gap-0.5">
                    <Text className="text-[15px] font-semibold" style={{ color: theme.text }}>{label}</Text>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{help}</Text>
                  </View>
                </Pressable>
              );
            })}
            {reasonError ? (
              <Text accessibilityRole="alert" className="text-sm" style={{ color: theme.error }}>{reasonError}</Text>
            ) : null}
          </View>

          <View>
            <TextArea
              label={category === 'other' ? t('memberReport.detailsLabelRequired') : t('memberReport.detailsLabel')}
              placeholder={t('memberReport.detailsPlaceholder')}
              value={details}
              onChangeText={(value) => {
                setDetails(value);
                setDetailsError(null);
              }}
              maxLength={MEMBER_REPORT_DETAILS_MAX}
              editable={!submitting}
              error={detailsError ?? undefined}
              containerClassName="mb-1"
            />
            <Text className="text-xs" style={{ color: theme.textMuted }}>
              {t('memberReport.detailsCount', { used: details.length, max: MEMBER_REPORT_DETAILS_MAX })}
            </Text>
          </View>

          <View className="flex-row items-start gap-2">
            <Ionicons name="warning-outline" size={18} color={theme.warning} />
            <Text className="flex-1 text-sm leading-5" style={{ color: theme.text }}>
              {t('memberReport.emergency')}
            </Text>
          </View>

          {formError ? (
            <Text accessibilityRole="alert" className="text-sm" style={{ color: theme.error }}>{formError}</Text>
          ) : null}

          <View className="flex-row gap-2">
            <View className="flex-1">
              <HeroButton variant="secondary" isDisabled={submitting} onPress={onClose} testID="report-member-cancel">
                <HeroButton.Label>{t('memberReport.cancel')}</HeroButton.Label>
              </HeroButton>
            </View>
            <View className="flex-1">
              <HeroButton
                variant="danger"
                isDisabled={submitting}
                onPress={() => void submit()}
                testID="report-member-submit"
                accessibilityLabel={t('memberReport.send')}
              >
                <HeroButton.Label>{submitting ? t('memberReport.sending') : t('memberReport.send')}</HeroButton.Label>
              </HeroButton>
            </View>
          </View>
        </View>
      )}
    </BottomSheet>
  );
}
