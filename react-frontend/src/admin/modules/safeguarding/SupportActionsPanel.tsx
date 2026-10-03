// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Support actions — things a supporter has prepared on a member's behalf that
 * wait for the member's answer (co-decide), plus the record of formal
 * authority staff have sighted behind act-alone relationships. Formerly the
 * fourth tab of the safeguarding dashboard; now its own page in the broker
 * panel.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import ShieldCheck from 'lucide-react/icons/shield-check';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Shield from 'lucide-react/icons/shield';
import {
  Button, Card, CardBody, CardHeader, Checkbox, Chip, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader,
  Select, SelectItem, Spinner, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, Textarea, useDisclosure,
} from '@/components/ui';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatRelativeTime, getFormattingLocale } from '@/lib/helpers';
import {
  ATTEST_CHANNELS,
  AUTHORITY_TYPES,
  REVOCATION_REASONS,
  requestBadgeRefresh,
  type AttestChannel,
  type AuthorityAttestation,
  type AuthorityRelationship,
  type AuthorityType,
  type RevocationReason,
  type SupportActionRow,
} from './safeguardingShared';

export function SupportActionsPanel() {
  const { t } = useTranslation('admin_safeguarding');
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [supportActions, setSupportActions] = useState<SupportActionRow[]>([]);
  const [authorityRels, setAuthorityRels] = useState<AuthorityRelationship[]>([]);

  // Attest an offline confirmation (co-decide)
  const attestModal = useDisclosure();
  const [attestTarget, setAttestTarget] = useState<SupportActionRow | null>(null);
  const [attestChannel, setAttestChannel] = useState<AttestChannel>('phone');
  const [attestWitness, setAttestWitness] = useState('');
  const [attesting, setAttesting] = useState(false);

  // Authority records (act-alone relationships)
  const authorityModal = useDisclosure();
  const [authorityTarget, setAuthorityTarget] = useState<AuthorityRelationship | null>(null);
  const [authorityType, setAuthorityType] = useState<AuthorityType>('power_of_attorney');
  const [authorityAcknowledged, setAuthorityAcknowledged] = useState(false);
  const [authorityScope, setAuthorityScope] = useState('');
  const [authoritySubmitting, setAuthoritySubmitting] = useState(false);
  const revokeAuthorityModal = useDisclosure();
  const [revokeAuthorityTarget, setRevokeAuthorityTarget] = useState<AuthorityAttestation | null>(null);
  const [revokeAuthorityReason, setRevokeAuthorityReason] = useState<RevocationReason>('authority_ended');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [supportRes, authorityRes] = await Promise.all([
        api.get<{ actions: SupportActionRow[] }>('/v2/admin/safeguarding/support-actions'),
        api.get<{ relationships: AuthorityRelationship[] }>('/v2/admin/safeguarding/authority-attestations'),
      ]);
      if (supportRes.success) {
        const payload = supportRes.data;
        setSupportActions(Array.isArray(payload) ? payload : payload?.actions ?? []);
      }
      if (authorityRes.success) {
        const payload = authorityRes.data;
        setAuthorityRels(Array.isArray(payload) ? payload : payload?.relationships ?? []);
      }
      setFailed(!supportRes.success || !authorityRes.success);
    } catch (err) {
      logError('SupportActionsPanel.load', err);
      setFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The member approved by phone / in person / on paper; staff record it
  // here. The record is stored as 'attested_offline' — deliberately
  // distinguishable from the member's own click — and the member is notified
  // that it was recorded in their name.
  const handleAttest = useCallback(async () => {
    if (!attestTarget) return;
    setAttesting(true);
    try {
      const body: Record<string, string> = { channel: attestChannel };
      if (attestWitness.trim() !== '') body.witness = attestWitness.trim();
      const res = await api.post(`/v2/admin/safeguarding/support-actions/${attestTarget.id}/attest`, body);
      if (res.success) {
        toast.success(t('safeguarding.support.attested_toast'));
        setAttestTarget(null);
        setAttestWitness('');
        attestModal.onClose();
        requestBadgeRefresh();
        await load();
      } else {
        // admin-i18n-ignore: localized server message — AdminSafeguardingController
        toast.error(res.error || t('safeguarding.support.attest_failed'));
      }
    } catch (err) {
      logError('SupportActionsPanel.attest', err);
      toast.error(t('safeguarding.support.attest_failed'));
    } finally {
      setAttesting(false);
    }
  }, [attestTarget, attestChannel, attestWitness, attestModal, load, toast, t]);

  const handleAttestAuthority = useCallback(async () => {
    if (!authorityTarget || !authorityAcknowledged) return;
    setAuthoritySubmitting(true);
    try {
      const body: Record<string, unknown> = {
        relationship_id: authorityTarget.relationship_id,
        authority_type: authorityType,
        acknowledged_sighted: true,
      };
      if (authorityScope.trim() !== '') body.scope_summary = authorityScope.trim();
      const res = await api.post('/v2/admin/safeguarding/authority-attestations', body);
      if (res.success) {
        toast.success(t('safeguarding.authority.attested_toast'));
        setAuthorityTarget(null);
        setAuthorityScope('');
        setAuthorityAcknowledged(false);
        authorityModal.onClose();
        await load();
      } else {
        // admin-i18n-ignore: localized server message — AdminSafeguardingController
        toast.error(res.error || t('safeguarding.authority.attest_failed'));
      }
    } catch (err) {
      logError('SupportActionsPanel.attestAuthority', err);
      toast.error(t('safeguarding.authority.attest_failed'));
    } finally {
      setAuthoritySubmitting(false);
    }
  }, [authorityTarget, authorityAcknowledged, authorityType, authorityScope, authorityModal, load, toast, t]);

  const handleRevokeAuthority = useCallback(async () => {
    if (!revokeAuthorityTarget) return;
    setAuthoritySubmitting(true);
    try {
      const res = await api.post(
        `/v2/admin/safeguarding/authority-attestations/${revokeAuthorityTarget.id}/revoke`,
        { reason_code: revokeAuthorityReason },
      );
      if (res.success) {
        toast.success(t('safeguarding.authority.revoked_toast'));
        setRevokeAuthorityTarget(null);
        revokeAuthorityModal.onClose();
        await load();
      } else {
        // admin-i18n-ignore: localized server message — AdminSafeguardingController
        toast.error(res.error || t('safeguarding.authority.attest_failed'));
      }
    } catch (err) {
      logError('SupportActionsPanel.revokeAuthority', err);
      toast.error(t('safeguarding.authority.attest_failed'));
    } finally {
      setAuthoritySubmitting(false);
    }
  }, [revokeAuthorityTarget, revokeAuthorityReason, revokeAuthorityModal, load, toast, t]);

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-10">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" startContent={<RefreshCw size={16} />} onPress={() => void load()}>
          {t('safeguarding.refresh')}
        </Button>
      </div>

      {failed && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <Shield size={16} aria-hidden="true" />
          {t('safeguarding.failed_to_load_safeguarding_data')}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col items-start gap-1">
          <h2 className="text-lg font-semibold">{t('safeguarding.support.title')}</h2>
          {/* What this queue is, and the honesty rule for recording offline
              approvals, stated where staff will act on it. */}
          <p className="text-sm text-muted">{t('safeguarding.support.intro')}</p>
        </CardHeader>
        <CardBody>
          <Table aria-label={t('safeguarding.support.title')} removeWrapper>
            <TableHeader>
              <TableColumn>{t('safeguarding.support.col_what')}</TableColumn>
              <TableColumn>{t('safeguarding.support.col_supported')}</TableColumn>
              <TableColumn>{t('safeguarding.support.col_prepared_by')}</TableColumn>
              <TableColumn>{t('safeguarding.col_created')}</TableColumn>
              <TableColumn>{t('safeguarding.col_expires')}</TableColumn>
              <TableColumn>{t('safeguarding.col_actions')}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={t('safeguarding.support.none_pending')}>
              {supportActions.map((action) => (
                <TableRow key={action.id}>
                  <TableCell>
                    <span className="text-sm">
                      {t(`safeguarding.support.type_${action.action_type}`)}
                      {action.payload_summary.title ? ` — ${action.payload_summary.title}` : ''}
                      {action.payload_summary.amount != null ? ` — ${action.payload_summary.amount}` : ''}
                      {action.payload_summary.recipient_id != null ? ` → ${action.payload_summary.recipient_name ?? ''} (#${action.payload_summary.recipient_id})` : ''}
                    </span>
                  </TableCell>
                  <TableCell><span className="text-sm">{action.supported_name}</span></TableCell>
                  <TableCell><span className="text-sm">{action.supporter_name}</span></TableCell>
                  <TableCell>
                    <span className="text-sm text-muted">{action.created_at ? formatRelativeTime(action.created_at) : ''}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted">
                      {action.expires_at ? new Date(action.expires_at).toLocaleDateString(getFormattingLocale()) : ''}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="secondary"
                      startContent={<ClipboardCheck size={14} />}
                      onPress={() => {
                        setAttestTarget(action);
                        setAttestChannel('phone');
                        setAttestWitness('');
                        attestModal.onOpen();
                      }}
                    >
                      {t('safeguarding.support.attest_button')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      {/* Authority records — act-alone relationships and the formal authority
          sighted behind them. A record, not authorisation: nothing grants
          power because of it. */}
      <Card>
        <CardHeader className="flex flex-col items-start gap-1">
          <h2 className="text-lg font-semibold">{t('safeguarding.authority.title')}</h2>
          <p className="text-sm text-muted">{t('safeguarding.authority.intro')}</p>
        </CardHeader>
        <CardBody>
          <Table aria-label={t('safeguarding.authority.title')} removeWrapper>
            <TableHeader>
              <TableColumn>{t('safeguarding.support.col_supported')}</TableColumn>
              <TableColumn>{t('safeguarding.authority.col_supporter')}</TableColumn>
              <TableColumn>{t('safeguarding.authority.col_records')}</TableColumn>
              <TableColumn>{t('safeguarding.col_actions')}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={t('safeguarding.authority.none')}>
              {authorityRels.map((rel) => (
                <TableRow key={rel.relationship_id}>
                  <TableCell><span className="text-sm">{rel.supported_name}</span></TableCell>
                  <TableCell><span className="text-sm">{rel.supporter_name}</span></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {rel.attestations.length === 0 && (
                        <Chip size="sm" variant="soft" color="warning">{t('safeguarding.authority.none_recorded')}</Chip>
                      )}
                      {rel.attestations.map((attestation) => (
                        <Chip
                          key={attestation.id}
                          size="sm"
                          variant="soft"
                          color={attestation.decision === 'active' ? 'success' : 'default'}
                          onClose={attestation.decision === 'active' ? () => {
                            setRevokeAuthorityTarget(attestation);
                            setRevokeAuthorityReason('authority_ended');
                            revokeAuthorityModal.onOpen();
                          } : undefined}
                        >
                          {t(`safeguarding.authority.type_${attestation.authority_type}`)}
                          {attestation.decision === 'revoked' ? ` — ${t('safeguarding.authority.revoked_chip')}` : ''}
                        </Chip>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="secondary"
                      startContent={<ShieldCheck size={14} />}
                      onPress={() => {
                        setAuthorityTarget(rel);
                        setAuthorityType('power_of_attorney');
                        setAuthorityAcknowledged(false);
                        setAuthorityScope('');
                        authorityModal.onOpen();
                      }}
                    >
                      {t('safeguarding.authority.attest_button')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      {/* Attest an offline confirmation. Closed channel vocabulary; witness
          optional. The copy carries the two honesty rules: this record is
          distinguishable from the member's own click, and the member will be
          told it was recorded in their name. */}
      <Modal isOpen={attestModal.isOpen} onOpenChange={attestModal.onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <ClipboardCheck size={20} />
                {t('safeguarding.support.attest_title')}
              </ModalHeader>
              <ModalBody className="gap-4">
                {attestTarget && (
                  <p className="text-sm text-muted">
                    {t('safeguarding.support.attest_intro', {
                      what: t(`safeguarding.support.type_${attestTarget.action_type}`),
                      name: attestTarget.supported_name ?? '',
                    })}
                  </p>
                )}
                <Select
                  label={t('safeguarding.support.channel_label')}
                  selectedKeys={[attestChannel]}
                  onSelectionChange={(keys) => {
                    const value = Array.from(keys)[0] as AttestChannel | undefined;
                    if (value && (ATTEST_CHANNELS as readonly string[]).includes(value)) setAttestChannel(value);
                  }}
                >
                  {ATTEST_CHANNELS.map((channel) => (
                    <SelectItem key={channel} id={channel}>
                      {t(`safeguarding.support.channel_${channel}`)}
                    </SelectItem>
                  ))}
                </Select>
                <Input
                  label={t('safeguarding.support.witness_label')}
                  description={t('safeguarding.support.witness_hint')}
                  value={attestWitness}
                  onValueChange={setAttestWitness}
                  maxLength={160}
                />
                <p className="text-xs text-muted">{t('safeguarding.support.attest_notice')}</p>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('safeguarding.cancel')}</Button>
                <Button isLoading={attesting} onPress={handleAttest}>
                  {t('safeguarding.support.attest_confirm_button')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Record that formal authority was SIGHTED. Evidence is refused by
          design — no document numbers, no dates, no uploads — and the explicit
          acknowledgement checkbox is the substance of the attestation. */}
      <Modal isOpen={authorityModal.isOpen} onOpenChange={authorityModal.onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <ShieldCheck size={20} />
                {t('safeguarding.authority.attest_title')}
              </ModalHeader>
              <ModalBody className="gap-4">
                {authorityTarget && (
                  <p className="text-sm text-muted">
                    {t('safeguarding.authority.attest_intro', {
                      supporter: authorityTarget.supporter_name ?? '',
                      supported: authorityTarget.supported_name ?? '',
                    })}
                  </p>
                )}
                <Select
                  label={t('safeguarding.authority.type_label')}
                  selectedKeys={[authorityType]}
                  onSelectionChange={(keys) => {
                    const value = Array.from(keys)[0] as AuthorityType | undefined;
                    if (value && (AUTHORITY_TYPES as readonly string[]).includes(value)) setAuthorityType(value);
                  }}
                >
                  {AUTHORITY_TYPES.map((type) => (
                    <SelectItem key={type} id={type}>
                      {t(`safeguarding.authority.type_${type}`)}
                    </SelectItem>
                  ))}
                </Select>
                <Textarea
                  label={t('safeguarding.authority.scope_label')}
                  description={t('safeguarding.authority.scope_hint')}
                  value={authorityScope}
                  onValueChange={setAuthorityScope}
                  maxLength={2000}
                  minRows={2}
                  maxRows={4}
                />
                {/* No document fields exist on purpose, and the copy says so. */}
                <p className="text-xs text-muted">{t('safeguarding.authority.no_evidence_notice')}</p>
                <Checkbox isSelected={authorityAcknowledged} onValueChange={setAuthorityAcknowledged}>
                  {t('safeguarding.authority.ack_label')}
                </Checkbox>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('safeguarding.cancel')}</Button>
                <Button
                  isLoading={authoritySubmitting}
                  isDisabled={!authorityAcknowledged}
                  onPress={handleAttestAuthority}
                >
                  {t('safeguarding.authority.attest_confirm_button')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Revoke an authority record — closed reason vocabulary only. */}
      <Modal isOpen={revokeAuthorityModal.isOpen} onOpenChange={revokeAuthorityModal.onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{t('safeguarding.authority.revoke_title')}</ModalHeader>
              <ModalBody className="gap-4">
                <p className="text-sm text-muted">{t('safeguarding.authority.revoke_intro')}</p>
                <Select
                  label={t('safeguarding.authority.revoke_reason_label')}
                  selectedKeys={[revokeAuthorityReason]}
                  onSelectionChange={(keys) => {
                    const value = Array.from(keys)[0] as RevocationReason | undefined;
                    if (value && (REVOCATION_REASONS as readonly string[]).includes(value)) setRevokeAuthorityReason(value);
                  }}
                >
                  {REVOCATION_REASONS.map((reason) => (
                    <SelectItem key={reason} id={reason}>
                      {t(`safeguarding.authority.reason_${reason}`)}
                    </SelectItem>
                  ))}
                </Select>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('safeguarding.cancel')}</Button>
                <Button color="danger" isLoading={authoritySubmitting} onPress={handleRevokeAuthority}>
                  {t('safeguarding.authority.revoke_confirm_button')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default SupportActionsPanel;
