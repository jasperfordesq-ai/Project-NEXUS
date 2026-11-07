// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import AlertCircle from 'lucide-react/icons/circle-alert';
import CheckCircle2 from 'lucide-react/icons/circle-check-big';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Users from 'lucide-react/icons/users';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageMeta } from '@/components/seo/PageMeta';
import { useTenant } from '@/contexts';
import { resolveAssetUrl } from '@/lib/helpers';
import {
  acceptGroupInvite,
  getGroupInvitePreview,
  GroupApiError,
  type GroupInviteAcceptance,
  type GroupInvitePreview,
} from './api';

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; preview: GroupInvitePreview }
  | { status: 'accepting'; preview: GroupInvitePreview }
  | { status: 'success'; result: GroupInviteAcceptance }
  | { status: 'error'; code: string };

function inviteErrorKey(code: string): string {
  switch (code) {
    case 'EXPIRED': return 'invite_accept.error_expired';
    case 'REVOKED': return 'invite_accept.error_revoked';
    case 'EMAIL_MISMATCH': return 'invite_accept.error_email_mismatch';
    case 'CAPACITY_FULL': return 'invite_accept.error_capacity';
    case 'MEMBERSHIP_LIMIT_REACHED': return 'invite_accept.error_limit';
    case 'GROUP_UNAVAILABLE': return 'invite_accept.error_group_unavailable';
    default: return 'invite_accept.error_invalid';
  }
}

export default function GroupInviteAcceptPage() {
  const { token = '' } = useParams<{ token: string }>();
  const { t } = useTranslation('groups');
  const { tenantPath } = useTenant();
  const navigate = useNavigate();
  const [state, setState] = useState<PageState>({ status: 'loading' });

  const loadPreview = useCallback(async (signal?: AbortSignal) => {
    if (!/^[A-Za-z0-9]{40}$/.test(token)) {
      setState({ status: 'error', code: 'NOT_FOUND' });
      return;
    }

    setState({ status: 'loading' });
    try {
      const preview = await getGroupInvitePreview(token, { signal });
      if (!signal?.aborted) setState({ status: 'ready', preview });
    } catch (error) {
      if (error instanceof GroupApiError && error.isCancellation) return;
      if (!signal?.aborted) {
        setState({
          status: 'error',
          code: error instanceof GroupApiError ? error.sourceCode : 'REQUEST_FAILED',
        });
      }
    }
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPreview(controller.signal);
    return () => controller.abort();
  }, [loadPreview]);

  const accept = useCallback(async () => {
    if (state.status !== 'ready') return;
    setState({ status: 'accepting', preview: state.preview });
    try {
      setState({ status: 'success', result: await acceptGroupInvite(token) });
    } catch (error) {
      setState({
        status: 'error',
        code: error instanceof GroupApiError ? error.sourceCode : 'REQUEST_FAILED',
      });
    }
  }, [state, token]);

  const group = state.status === 'ready' || state.status === 'accepting' ? state.preview.group : null;
  const alreadyMember = state.status === 'ready' && state.preview.membership.status === 'active';

  return (
    <>
      <PageMeta title={t('invite_accept.title')} description={t('invite_accept.description')} />
      <main className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center px-4 py-8 sm:py-12">
        <GlassCard className="w-full p-5 text-center sm:p-8">
          {state.status === 'loading' && (
            <div role="status" aria-live="polite" className="space-y-4 py-8">
              <RefreshCw className="mx-auto h-9 w-9 animate-spin text-accent" aria-hidden="true" />
              <p className="text-theme-secondary">{t('invite_accept.checking')}</p>
            </div>
          )}

          {(state.status === 'ready' || state.status === 'accepting') && group && (
            <div className="space-y-5">
              {group.image_url ? (
                <img
                  src={resolveAssetUrl(group.image_url)}
                  // The group name is the heading right below; without a
                  // written description the picture stays decorative.
                  alt={group.image_alt?.trim() || ''}
                  className="mx-auto h-20 w-20 rounded-2xl object-cover"
                />
              ) : (
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-accent/10">
                  <Users className="h-10 w-10 text-accent" aria-hidden="true" />
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold text-theme-primary">{group.name}</h1>
                <p className="mt-2 text-theme-secondary">
                  {alreadyMember ? t('invite_accept.success_description') : t('invite_accept.description')}
                </p>
              </div>
              {alreadyMember ? (
                <Button
                  color="primary"
                  className="w-full sm:w-auto"
                  onPress={() => navigate(tenantPath(`/groups/${group.id}`))}
                >
                  {t('invite_accept.go_to_group')}
                </Button>
              ) : (
                <Button
                  color="primary"
                  className="w-full sm:w-auto"
                  isLoading={state.status === 'accepting'}
                  onPress={accept}
                >
                  {state.status === 'accepting' ? t('invite_accept.accepting') : t('invite_accept.accept')}
                </Button>
              )}
            </div>
          )}

          {state.status === 'success' && (
            <div className="space-y-5" role="status" aria-live="polite">
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" aria-hidden="true" />
              <div>
                <h1 className="text-2xl font-bold text-theme-primary">{t('invite_accept.success_title')}</h1>
                <p className="mt-2 text-theme-secondary">{t('invite_accept.success_description')}</p>
              </div>
              <Button
                color="primary"
                className="w-full sm:w-auto"
                onPress={() => navigate(tenantPath(`/groups/${state.result.group.id}`))}
              >
                {t('invite_accept.go_to_group')}
              </Button>
            </div>
          )}

          {state.status === 'error' && (
            <div className="space-y-5" role="alert">
              <AlertCircle className="mx-auto h-14 w-14 text-danger" aria-hidden="true" />
              <div>
                <h1 className="text-2xl font-bold text-theme-primary">{t('invite_accept.title')}</h1>
                <p className="mt-2 text-theme-secondary">{t(inviteErrorKey(state.code))}</p>
              </div>
              <div className="flex flex-col justify-center gap-3 sm:flex-row">
                <Button variant="flat" onPress={() => navigate(tenantPath('/groups'))}>
                  {t('detail.browse_groups')}
                </Button>
                <Button color="primary" onPress={() => void loadPreview()}>
                  {t('detail.try_again')}
                </Button>
              </div>
            </div>
          )}
        </GlassCard>
      </main>
    </>
  );
}
