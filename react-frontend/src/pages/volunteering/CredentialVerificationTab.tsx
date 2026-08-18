// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CredentialVerificationTab - Manage volunteer credentials/certifications (V5)
 *
 * Upload, view, and track non-vetting volunteer credentials. Historical
 * police-check evidence is rendered as a redacted, removal-only row.
 */

import { formatNumber, getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from '@/lib/motion';

import ShieldCheck from 'lucide-react/icons/shield-check';
import Upload from 'lucide-react/icons/upload';
import FileText from 'lucide-react/icons/file-text';
import Clock from 'lucide-react/icons/clock';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Hourglass from 'lucide-react/icons/hourglass';
import Calendar from 'lucide-react/icons/calendar';
import Trash2 from 'lucide-react/icons/trash-2';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { useToast } from '@/contexts';

/* ───────────────────────── Types ───────────────────────── */

interface StandardCredential {
  id: number;
  type: string;
  type_label: string;
  document_name: string;
  upload_date: string;
  expiry_date: string | null;
  status: 'pending' | 'verified' | 'expired' | 'rejected';
  rejection_reason: string | null;
  legacy_vetting_evidence?: false;
  manual_review_required?: false;
}

interface LegacyVettingEvidenceCredential {
  id: number;
  legacy_vetting_evidence: true;
  manual_review_required?: false;
}

interface ManualReviewCredential {
  id: number;
  type: string;
  type_label: string;
  legacy_vetting_evidence?: false;
  manual_review_required: true;
}

type Credential = StandardCredential | LegacyVettingEvidenceCredential | ManualReviewCredential;

/* ───────────────────────── Credential Type Options ───────────────────────── */

export const CREDENTIAL_TYPE_KEYS = [
  'first_aid',
  'safeguarding',
  'manual_handling',
  'food_hygiene',
  'driving_licence',
  'professional_registration',
  'other',
] as const;

const PROHIBITED_VETTING_CREDENTIAL_TYPES = new Set([
  'police_check',
  'background_check',
  'dbs',
  'dbs_basic',
  'dbs_standard',
  'dbs_enhanced',
  'garda_vetting',
  'access_ni',
  'pvg_scotland',
]);

/* ───────────────────────── Status Helpers ───────────────────────── */

function getStatusColor(status: string): 'warning' | 'success' | 'danger' | 'default' {
  switch (status) {
    case 'pending': return 'warning';
    case 'verified': return 'success';
    case 'expired': return 'danger';
    case 'rejected': return 'danger';
    default: return 'default';
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'pending': return <Hourglass className="w-3 h-3" />;
    case 'verified': return <CheckCircle className="w-3 h-3" />;
    case 'expired': return <Clock className="w-3 h-3" />;
    case 'rejected': return <XCircle className="w-3 h-3" />;
    default: return <Hourglass className="w-3 h-3" />;
  }
}

function getStatusLabel(status: string, t: (key: string) => string): string {
  switch (status) {
    case 'pending': return t('credentials.status_pending');
    case 'verified': return t('credentials.status_verified');
    case 'expired': return t('credentials.status_expired');
    case 'rejected': return t('credentials.status_rejected');
    default: return status;
  }
}

/* ───────────────────────── Main Component ───────────────────────── */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export function CredentialVerificationTab() {
  const { t } = useTranslation('volunteering');
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload modal state
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [uploadForm, setUploadForm] = useState({
    type: '',
    expiry_date: '',
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingCredentialId, setDeletingCredentialId] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);

      const response = await api.get<{ credentials?: Credential[] }>('/v2/volunteering/credentials');

      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        const payload = response.data as { credentials?: Credential[] } | Credential[];
        const items = Array.isArray(payload) ? payload : (payload.credentials ?? []);
        setCredentials(items);
      } else {
        setError(tRef.current('credentials.load_failed'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load credentials', err);
      setError(tRef.current('credentials.load_error'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file) {
      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        setUploadError(t('credentials.file_too_large'));
        setSelectedFile(null);
        return;
      }
      // Validate file type
      const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.type)) {
        setUploadError(t('credentials.invalid_file_type'));
        setSelectedFile(null);
        return;
      }
      setUploadError(null);
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!uploadForm.type || !selectedFile || PROHIBITED_VETTING_CREDENTIAL_TYPES.has(uploadForm.type)) return;

    try {
      setIsUploading(true);
      setUploadError(null);

      const formData = new FormData();
      formData.append('credential_type', uploadForm.type);
      formData.append('file', selectedFile);
      if (uploadForm.expiry_date) {
        formData.append('expires_at', uploadForm.expiry_date);
      }

      const response = await api.upload('/v2/volunteering/credentials', formData);

      if (response.success) {
        toastRef.current.success(tRef.current('credentials.upload_success'));
        onClose();
        resetUploadForm();
        load();
      } else {
        setUploadError(tRef.current('credentials.upload_failed'));
      }
    } catch (err) {
      logError('Failed to upload credential', err);
      setUploadError(tRef.current('credentials.upload_error'));
    } finally {
      setIsUploading(false);
    }
  };

  const resetUploadForm = () => {
    setUploadForm({ type: '', expiry_date: '' });
    setSelectedFile(null);
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleModalClose = () => {
    onClose();
    resetUploadForm();
  };

  const handleDeleteRemovalOnlyCredential = async (
    credential: LegacyVettingEvidenceCredential | ManualReviewCredential,
    translationPrefix: 'legacy_vetting_evidence' | 'manual_review',
  ) => {
    try {
      setDeletingCredentialId(credential.id);
      const response = await api.delete(`/v2/volunteering/credentials/${credential.id}`);
      if (!response.success) {
        toastRef.current.error(tRef.current(`credentials.${translationPrefix}_delete_failed`));
        return;
      }

      setCredentials((current) => current.filter((item) => item.id !== credential.id));
      toastRef.current.success(tRef.current(`credentials.${translationPrefix}_delete_success`));
    } catch (err) {
      logError('Failed to delete removal-only credential', err);
      toastRef.current.error(tRef.current(`credentials.${translationPrefix}_delete_failed`));
    } finally {
      setDeletingCredentialId(null);
    }
  };

  // Separate credentials by status for summary
  const activeCredentials = credentials.filter(
    (credential): credential is StandardCredential =>
      !credential.legacy_vetting_evidence && !credential.manual_review_required,
  );
  const verified = activeCredentials.filter((c) => c.status === 'verified');
  const pending = activeCredentials.filter((c) => c.status === 'pending');
  const expiring = activeCredentials.filter((c) => {
    if (!c.expiry_date || c.status !== 'verified') return false;
    const expiryDate = new Date(c.expiry_date);
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return expiryDate <= thirtyDaysFromNow && expiryDate > now;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">{t('credentials.heading')}</h2>
        </div>
        <Button
          size="sm"
          className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
          startContent={<Upload className="w-4 h-4" aria-hidden="true" />}
          onPress={onOpen}
        >
          {t('credentials.upload_new')}
        </Button>
      </div>

      <GlassCard className="border-l-4 border-amber-500 p-4" role="note">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-theme-primary">{t('credentials.vetting_documents_notice_title')}</p>
            <p className="mt-1 text-sm leading-6 text-theme-muted">{t('credentials.vetting_documents_notice_body')}</p>
          </div>
        </div>
      </GlassCard>

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={load}
          >
            {t('credentials.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Loading */}
      {!error && isLoading && (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <CardRowsSkeleton key={i} />
            ))}
          </div>
          {[1, 2].map((i) => (
            <CardRowsSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!error && !isLoading && credentials.length === 0 && (
        <EmptyState
          icon={<ShieldCheck className="w-12 h-12" aria-hidden="true" />}
          title={t('credentials.no_credentials_title')}
          description={t('credentials.no_credentials_desc')}
          action={
            <Button
              className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
              startContent={<Upload className="w-4 h-4" aria-hidden="true" />}
              onPress={onOpen}
            >
              {t('credentials.upload_new')}
            </Button>
          }
        />
      )}

      {/* Dashboard Content */}
      {!error && !isLoading && credentials.length > 0 && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          {/* Summary Cards */}
          <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <GlassCard className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-emerald-400" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-theme-primary">{verified.length}</p>
                  <p className="text-xs text-theme-muted">{t('credentials.status_verified')}</p>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <Hourglass className="w-5 h-5 text-amber-400" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-theme-primary">{pending.length}</p>
                  <p className="text-xs text-theme-muted">{t('credentials.status_pending')}</p>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-rose-400" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-theme-primary">{expiring.length}</p>
                  <p className="text-xs text-theme-muted">{t('credentials.expiring_soon')}</p>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* Expiring Soon Warning */}
          {expiring.length > 0 && (
            <motion.div variants={itemVariants}>
              <GlassCard className="p-4 border-l-4 border-amber-500">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium text-theme-primary">{t('credentials.expiring_soon_title')}</p>
                    <p className="text-sm text-theme-muted">
                      {t('credentials.expiring_soon_desc', { count: expiring.length })}
                    </p>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          )}

          {/* Credentials List */}
          {credentials.map((credential) => (
            <motion.div key={credential.id} variants={itemVariants}>
              {credential.legacy_vetting_evidence ? (
                <GlassCard className="border-l-4 border-rose-500 p-5" role="alert">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" aria-hidden="true" />
                      <div>
                        <h3 className="font-semibold text-theme-primary">
                          {t('credentials.legacy_vetting_evidence_title')}
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-theme-muted">
                          {t('credentials.legacy_vetting_evidence_body')}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      color="danger"
                      variant="secondary"
                      startContent={deletingCredentialId !== credential.id ? <Trash2 className="h-4 w-4" aria-hidden="true" /> : undefined}
                      isLoading={deletingCredentialId === credential.id}
                      isDisabled={deletingCredentialId !== null}
                      onPress={() => handleDeleteRemovalOnlyCredential(credential, 'legacy_vetting_evidence')}
                    >
                      {t('credentials.legacy_vetting_evidence_delete')}
                    </Button>
                  </div>
                </GlassCard>
              ) : credential.manual_review_required ? (
                <GlassCard className="border-l-4 border-amber-500 p-5" role="note">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-theme-primary">
                            {credential.type_label || t('credentials.manual_review_title')}
                          </h3>
                          <Chip
                            size="sm"
                            color="warning"
                            variant="soft"
                            startContent={<Hourglass className="h-3 w-3" aria-hidden="true" />}
                          >
                            {t('credentials.status_manual_review')}
                          </Chip>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-theme-muted">
                          {t('credentials.manual_review_body')}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      color="danger"
                      variant="secondary"
                      startContent={deletingCredentialId !== credential.id ? <Trash2 className="h-4 w-4" aria-hidden="true" /> : undefined}
                      isLoading={deletingCredentialId === credential.id}
                      isDisabled={deletingCredentialId !== null}
                      onPress={() => handleDeleteRemovalOnlyCredential(credential, 'manual_review')}
                    >
                      {t('credentials.manual_review_delete')}
                    </Button>
                  </div>
                </GlassCard>
              ) : (
              <GlassCard className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <FileText className="w-5 h-5 text-accent flex-shrink-0" aria-hidden="true" />
                      <h3 className="font-semibold text-theme-primary">{credential.type_label}</h3>
                      <Chip
                        size="sm"
                        color={getStatusColor(credential.status)}
                        variant="soft"
                        startContent={getStatusIcon(credential.status)}
                      >
                        {getStatusLabel(credential.status, t)}
                      </Chip>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-theme-subtle mb-2">
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3" aria-hidden="true" />
                        {credential.document_name}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" aria-hidden="true" />
                        {t('credentials.uploaded')} {new Date(credential.upload_date).toLocaleDateString(getFormattingLocale())}
                      </span>
                      {credential.expiry_date && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" aria-hidden="true" />
                          {t('credentials.expires')} {new Date(credential.expiry_date).toLocaleDateString(getFormattingLocale())}
                        </span>
                      )}
                    </div>

                    {credential.status === 'rejected' && credential.rejection_reason && (
                      <div className="mt-2 p-2 rounded-lg bg-rose-500/10">
                        <p className="text-xs text-rose-700 dark:text-rose-400">
                          <strong>{t('credentials.reason')}:</strong> {credential.rejection_reason}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 sm:flex-shrink-0">
                    {(credential.status === 'expired' || credential.status === 'rejected') &&
                      !PROHIBITED_VETTING_CREDENTIAL_TYPES.has(credential.type) && (
                      <Button
                        size="sm"
                        className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
                        startContent={<Upload className="w-4 h-4" aria-hidden="true" />}
                        onPress={() => {
                          setUploadForm((prev) => ({ ...prev, type: credential.type }));
                          onOpen();
                        }}
                      >
                        {t('credentials.re_upload')}
                      </Button>
                    )}
                  </div>
                </div>
              </GlassCard>
              )}
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Upload Credential Modal */}
      <Modal isOpen={isOpen} onClose={handleModalClose} size="lg" classNames={{
        base: 'bg-overlay border border-theme-default',
      }}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">
            <ModalHeading className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-rose-400" aria-hidden="true" />
              {t('credentials.upload_new')}
            </ModalHeading>
          </ModalHeader>
          <ModalBody className="space-y-4">
            <p className="text-sm text-theme-muted">
              {t('credentials.upload_instructions')}
            </p>

            {/* Credential Type */}
            <Select
              label={t('credentials.type_label')}
              placeholder={t('credentials.type_placeholder')}
              selectedKeys={uploadForm.type ? new Set([uploadForm.type]) : new Set()}
              onSelectionChange={(keys) => { const val = Array.from(keys)[0] as string; if (val) setUploadForm((prev) => ({ ...prev, type: val })); }}
              isRequired
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default',
                value: 'text-theme-primary',
              }}
              startContent={<ShieldCheck className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
            >
              {CREDENTIAL_TYPE_KEYS.map((key) => (
                <SelectItem key={key} id={key}>{t(`credentials.type_${key}`)}</SelectItem>
              ))}
            </Select>

            {/* File Upload */}
            <div>
              <label className="block text-sm font-medium text-theme-primary mb-2">
                {t('credentials.document_label')} <span className="text-rose-600 dark:text-rose-400">*</span>
              </label>
              <div
                className={`relative overflow-hidden border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                  selectedFile
                    ? 'border-emerald-500/50 bg-emerald-500/5'
                    : 'border-theme-default bg-theme-elevated hover:border-rose-500/50'
                }`}
              >
                {selectedFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileText className="w-8 h-8 text-emerald-400" aria-hidden="true" />
                    <div className="text-left">
                      <p className="text-sm font-medium text-theme-primary">{selectedFile.name}</p>
                      <p className="text-xs text-theme-muted">
                        {formatNumber(selectedFile.size / 1024 / 1024, {
                          style: 'unit',
                          unit: 'megabyte',
                          unitDisplay: 'short',
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      isIconOnly
                      variant="tertiary"
                      className="text-theme-muted"
                      onPress={() => {
                        setSelectedFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      aria-label={t('credentials.aria_remove_file')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-8 h-8 text-theme-muted mx-auto mb-2" aria-hidden="true" />
                    <p className="text-sm text-theme-muted mb-2">{t('credentials.click_to_browse')}</p>
                    <p className="text-xs text-theme-subtle">{t('credentials.file_types')}</p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={handleFileChange}
                  className={selectedFile ? 'hidden' : 'absolute inset-0 w-full h-full opacity-0 cursor-pointer'}
                  aria-label={t('credentials.aria_upload_document')}
                />
              </div>
            </div>

            {/* Expiry Date */}
            <Input
              type="date"
              label={t('credentials.expiry_label')}
              placeholder={t('credentials.expiry_placeholder')}
              value={uploadForm.expiry_date}
              onChange={(e) => setUploadForm((prev) => ({ ...prev, expiry_date: e.target.value }))}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />

            {/* Upload Error */}
            {uploadError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30">
                <p className="text-sm text-rose-700 dark:text-rose-400">{uploadError}</p>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={handleModalClose}>{t('credentials.cancel')}</Button>
            <Button
              className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
              onPress={handleUpload}
              isLoading={isUploading}
              isDisabled={!uploadForm.type || !selectedFile}
              startContent={!isUploading ? <Upload className="w-4 h-4" aria-hidden="true" /> : undefined}
            >
              {t('credentials.upload_credential')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default CredentialVerificationTab;
