// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import CheckCircle from 'lucide-react/icons/circle-check';
import Heart from 'lucide-react/icons/heart';
import Mic from 'lucide-react/icons/mic';
import Square from 'lucide-react/icons/square';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Radio, RadioGroup } from '@/components/ui/Radio';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';

type ContactPreference = 'phone' | 'message' | 'either';
type VoiceStatus = 'idle' | 'recording' | 'processing';

const MAX_RECORD_SECONDS = 60;

interface VoiceIntentResponse {
  transcript: string;
  detected_language?: string;
  suggested_category: string | null;
  suggested_when: string | null;
  suggested_contact_preference: ContactPreference | null;
  raw_text: string;
}

function formatSuggestedWhen(iso: string | null, locale: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d);
  } catch {
    return '';
  }
}

export function RequestHelpPage() {
  const { t, i18n } = useTranslation('common');
  const { hasFeature, tenantPath } = useTenant();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  usePageTitle(t('request_help.meta.title'));

  const [what, setWhat] = useState('');
  const [when, setWhen] = useState('');
  const [contactPref, setContactPref] = useState<ContactPreference>('either');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onBehalfOf = Number.parseInt(searchParams.get('on_behalf_of') ?? '', 10);
  const caredForId = Number.isFinite(onBehalfOf) && onBehalfOf > 0 ? onBehalfOf : null;

  // Voice state
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [voiceFilledHint, setVoiceFilledHint] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (recordTimerRef.current !== null) {
        window.clearInterval(recordTimerRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Redirect if feature is off
  if (!hasFeature('caring_community')) {
    return <Navigate to={tenantPath('/caring-community')} replace />;
  }

  const charCount = what.length;
  const charLimit = 500;

  const supportsVoice =
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia;

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const stopTimer = () => {
    if (recordTimerRef.current !== null) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const startRecording = async () => {
    setError(null);
    setVoiceFilledHint(false);
    if (!supportsVoice) {
      setError(t('request_help.errors.voice_unsupported'));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stopTracks();
        stopTimer();
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        void uploadAudio(blob);
      };

      recorder.start();
      setVoiceStatus('recording');
      setRecordSeconds(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((prev) => {
          const next = prev + 1;
          if (next >= MAX_RECORD_SECONDS) {
            stopRecording();
          }
          return next;
        });
      }, 1000);
    } catch {
      setError(t('request_help.errors.voice_permission_denied'));
      setVoiceStatus('idle');
      stopTracks();
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    stopTimer();
    setVoiceStatus('processing');
  };

  const uploadAudio = async (blob: Blob) => {
    try {
      const formData = new FormData();
      const ext = blob.type.includes('mp4')
        ? 'm4a'
        : blob.type.includes('ogg')
          ? 'ogg'
          : 'webm';
      formData.append('audio', blob, `voice.${ext}`);
      formData.append('locale', i18n.language || 'en');

      const response = await api.upload<VoiceIntentResponse>(
        '/v2/caring-community/request-help/voice',
        formData,
        'audio'
      );

      const data = response.data;
      if (!data || !data.transcript) {
        setError(t('request_help.errors.voice_failed'));
        setVoiceStatus('idle');
        return;
      }

      // Pre-fill form fields with suggestions; member can edit before submit.
      if (!what.trim()) setWhat(data.transcript.slice(0, charLimit));
      if (!when.trim() && data.suggested_when) {
        const formatted = formatSuggestedWhen(data.suggested_when, i18n.language || 'en');
        if (formatted) setWhen(formatted);
      }
      if (data.suggested_contact_preference) {
        setContactPref(data.suggested_contact_preference);
      }
      setVoiceTranscript(data.transcript);
      setVoiceFilledHint(true);
      setVoiceStatus('idle');
    } catch {
      setError(t('request_help.errors.voice_failed'));
      setVoiceStatus('idle');
    }
  };

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setError(null);
    if (!what.trim() || !when.trim()) return;

    setSubmitting(true);
    try {
      const response = caredForId !== null
        ? await api.post('/v2/caring-community/caregiver/request-on-behalf', {
            cared_for_id: caredForId,
            title: what.trim().slice(0, 120),
            description: what.trim(),
            when_needed: when.trim(),
            contact_preference: contactPref,
          })
        : await api.post('/v2/caring-community/request-help', {
            what: what.trim(),
            when: when.trim(),
            contact_preference: contactPref,
          });
      if (!response.success) {
        const message = response.error || t('request_help.errors.submit_failed');
        setError(message);
        showToast(message, 'error');
        return;
      }
      showToast(t('request_help.success.toast'), 'success');
      setSubmitted(true);
    } catch {
      const message = t('request_help.errors.submit_failed');
      setError(message);
      showToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <>
        <PageMeta
          title={t('request_help.meta.title')}
          description={t('request_help.meta.description')}
          noIndex
        />
        <div className="mx-auto max-w-xl">
          <GlassCard className="p-8 text-center">
            <div className="mb-4 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
                <CheckCircle className="h-8 w-8 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-theme-primary">{t('request_help.success.title')}</h1>
            <p className="mt-3 text-base leading-7 text-theme-muted">{t('request_help.success.body')}</p>
            <div className="mt-6">
              <Button
                as={Link}
                to={tenantPath('/caring-community')}
                color="primary"
                variant="flat"
                startContent={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
              >
                {t('request_help.success.back')}
              </Button>
            </div>
          </GlassCard>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta
        title={t('request_help.meta.title')}
        description={t('request_help.meta.description')}
        noIndex
      />

      <div className="mx-auto max-w-xl space-y-4">
        <div>
          <Link
            to={tenantPath('/caring-community')}
            className="inline-flex items-center gap-1 text-sm text-theme-muted hover:text-theme-primary"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('request_help.back')}
          </Link>
        </div>

        <GlassCard className="p-6 sm:p-8">
          <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-500/15">
              <Heart className="h-6 w-6 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold leading-tight text-theme-primary">{t('request_help.meta.title')}</h1>
              <p className="mt-1 text-base leading-7 text-theme-muted">{t('request_help.subtitle')}</p>
            </div>
          </div>

          {caredForId !== null && (
            <p className="mb-6 rounded-lg bg-accent-soft px-4 py-3 text-sm text-accent dark:text-accent">
              {t('request_help.on_behalf_notice')}
            </p>
          )}

          {supportsVoice && (
            <div className="mb-6" aria-live="polite">
              <Button
                type="button"
                color={voiceStatus === 'recording' ? 'danger' : 'secondary'}
                variant="flat"
                size="lg"
                className="w-full text-base"
                onPress={voiceStatus === 'recording' ? stopRecording : startRecording}
                isDisabled={voiceStatus === 'processing'}
                startContent={
                  voiceStatus === 'processing' ? (
                    <Spinner size="md" aria-hidden="true" />
                  ) : voiceStatus === 'recording' ? (
                    <Square className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <Mic className="h-5 w-5" aria-hidden="true" />
                  )
                }
              >
                {voiceStatus === 'recording'
                  ? t('request_help.voice.recording', { seconds: recordSeconds })
                  : voiceStatus === 'processing'
                    ? t('request_help.voice.processing')
                    : t('request_help.voice.start')}
              </Button>

              {voiceFilledHint && (
                <p className="mt-3 rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-theme-success">
                  {t('request_help.voice.filled_hint')}
                </p>
              )}
              {voiceTranscript && voiceFilledHint && (
                <details className="mt-2 text-sm text-theme-muted">
                  <summary className="cursor-pointer">{t('request_help.voice.transcript_label')}</summary>
                  <p className="mt-1 italic">{voiceTranscript}</p>
                </details>
              )}
            </div>
          )}

          <form className="space-y-6" onSubmit={(event) => void handleSubmit(event)} noValidate>
            <div>
              <Textarea
                label={t('request_help.form.what_label')}
                classNames={{ label: 'text-base font-medium' }}
                placeholder={t('request_help.form.what_placeholder')}
                value={what}
                onValueChange={setWhat}
                minRows={3}
                maxRows={6}
                variant="bordered"
                isRequired
                description={`${charCount} / ${charLimit}`}
                isInvalid={charCount > charLimit}
                errorMessage={charCount > charLimit ? t('request_help.form.what_too_long') : undefined}
              />
            </div>

            <div>
              <Input
                label={t('request_help.form.when_label')}
                placeholder={t('request_help.form.when_placeholder')}
                value={when}
                onValueChange={setWhen}
                variant="bordered"
                isRequired
              />
            </div>

            <RadioGroup
              label={t('request_help.form.contact_label')}
              value={contactPref}
              onValueChange={(v) => setContactPref(v as ContactPreference)}
            >
              <Radio value="phone">{t('request_help.form.contact_phone')}</Radio>
              <Radio value="message">{t('request_help.form.contact_message')}</Radio>
              <Radio value="either">{t('request_help.form.contact_either')}</Radio>
            </RadioGroup>

            {error && (
              <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
                {error}
              </p>
            )}

            <Button
              type="submit"
              color="primary"
              size="lg"
              className="w-full text-base"
              isLoading={submitting}
              isDisabled={!what.trim() || !when.trim() || charCount > charLimit}
            >
              {submitting ? t('request_help.form.submitting') : t('request_help.form.submit')}
            </Button>
          </form>
        </GlassCard>
      </div>
    </>
  );
}

export default RequestHelpPage;
