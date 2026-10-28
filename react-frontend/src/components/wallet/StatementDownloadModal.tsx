// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * StatementDownloadModal — download the member's full wallet statement.
 *
 * Calls Laravel's GET /v2/wallet/statement, which returns a CSV of EVERY
 * transaction (optionally between `start_date` and `end_date`, YYYY-MM-DD,
 * both inclusive). It replaces the old client-side export that only contained
 * the rows already loaded on screen.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Download from 'lucide-react/icons/download';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

export interface StatementDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function statementEndpoint(startDate: string, endDate: string): string {
  const params = new URLSearchParams();
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  const query = params.toString();
  return query ? `/v2/wallet/statement?${query}` : '/v2/wallet/statement';
}

export function StatementDownloadModal({ isOpen, onClose }: StatementDownloadModalProps) {
  const { t } = useTranslation('wallet');
  const toast = useToast();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (isOpen) setRangeError(null);
  }, [isOpen]);

  const handleDownload = async () => {
    // ISO dates compare correctly as strings.
    if (startDate && endDate && endDate < startDate) {
      setRangeError(t('statement.range_invalid'));
      return;
    }
    setRangeError(null);
    setIsDownloading(true);
    try {
      // The server's Content-Disposition filename (which names the range) wins
      // over this fallback.
      await api.download(statementEndpoint(startDate, endDate), {
        filename: `wallet_statement_${new Date().toISOString().split('T')[0]}.csv`,
      });
      toast.success(t('statement.success'));
      onClose();
    } catch (err) {
      logError('Failed to download wallet statement', err);
      toast.error(t('statement.error'));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => { if (!open && !isDownloading) onClose(); }}
      size="md"
      placement="center"
    >
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Download className="w-5 h-5 text-accent" aria-hidden="true" />
          {t('statement.title')}
        </ModalHeader>
        <ModalBody className="space-y-4">
          <p className="text-sm text-theme-muted">{t('statement.description')}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label={t('statement.start_label')}
              type="date"
              value={startDate}
              onValueChange={(value) => { setStartDate(value); setRangeError(null); }}
              variant="bordered"
            />
            <Input
              label={t('statement.end_label')}
              type="date"
              value={endDate}
              onValueChange={(value) => { setEndDate(value); setRangeError(null); }}
              variant="bordered"
              isInvalid={rangeError !== null}
              errorMessage={rangeError ?? undefined}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={isDownloading}>
            {t('statement.cancel')}
          </Button>
          <Button
            onPress={handleDownload}
            isLoading={isDownloading}
            startContent={!isDownloading ? <Download className="w-4 h-4" aria-hidden="true" /> : undefined}
          >
            {t('statement.download')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default StatementDownloadModal;
