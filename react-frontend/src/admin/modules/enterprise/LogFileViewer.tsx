import { CardBody, Card, Select, SelectItem, Button, Spinner, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Switch } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Log File Viewer
 * View individual log file contents with filtering and auto-refresh.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Download from 'lucide-react/icons/download';
import Trash2 from 'lucide-react/icons/trash-2';
import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { adminEnterprise } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { LogFileContent } from '../../api/types';

import { useTranslation } from 'react-i18next';

const LINE_OPTION_KEYS = ['100', '200', '500', '1000'] as const;
const LEVEL_OPTION_KEYS = ['all', 'ERROR', 'WARNING', 'INFO', 'DEBUG'] as const;

const LEVEL_REGEX = /\[(ERROR|WARNING|INFO|DEBUG)\]/i;
const LEVEL_START_REGEX = /^(error|warning|info|debug)\b/i;

function detectLevel(text: string): string | null {
  const match = text.match(LEVEL_REGEX);
  if (match?.[1]) return match[1].toUpperCase();
  const startMatch = text.match(LEVEL_START_REGEX);
  if (startMatch?.[1]) return startMatch[1].toUpperCase();
  return null;
}

function levelColorClass(level: string | null): string {
  switch (level) {
    case 'ERROR':
      return 'text-danger';
    case 'WARNING':
      return 'text-warning';
    case 'INFO':
      return 'text-accent';
    case 'DEBUG':
      return 'text-muted';
    default:
      return 'text-muted/70';
  }
}

export function LogFileViewer() {
  const { t } = useTranslation('admin_enterprise');
  usePageTitle(t('enterprise.page_title'));
  const toast = useToast();
  const { tenantPath } = useTenant();
  const navigate = useNavigate();
  const { filename } = useParams<{ filename: string }>();

  const [content, setContent] = useState<LogFileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState(200);
  const [level, setLevel] = useState('all');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    if (!filename) return;
    try {
      const params: { lines?: number; level?: string } = { lines };
      if (level !== 'all') params.level = level;
      const res = await adminEnterprise.getLogFile(filename, params);
      if (res.success && res.data) {
        setContent(res.data as unknown as LogFileContent);
      }
    } catch {
      toast.error(t('enterprise.failed_to_load_log_file'));
    } finally {
      setLoading(false);
    }
  }, [filename, lines, level, t, toast])


  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        loadData();
      }, 5000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoRefresh, loadData]);

  const handleDownload = () => {
    if (!content) return;
    const text = content.content.map((l) => l.text).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = content.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = async () => {
    if (!filename) return;
    setClearing(true);
    try {
      const res = await adminEnterprise.clearLogFile(filename);
      if (res.success) {
        toast.success(t('enterprise.log_file_cleared'));
        setClearModalOpen(false);
        loadData();
      }
    } catch {
      toast.error(t('enterprise.failed_to_clear_log_file'));
    } finally {
      setClearing(false);
    }
  };

  const headerDescription = content
    ? content.filtered_count !== content.total_lines
      ? t('enterprise.log_viewer_desc_filtered', {
          total: content.total_lines,
          filtered: content.filtered_count,
        })
      : t('enterprise.log_viewer_desc', { total: content.total_lines })
    : t('enterprise.log_viewer_loading_desc');

  return (
    <div>
      <PageHeader
        title={filename || t('enterprise.log_viewer_title_fallback')}
        description={headerDescription}
        actions={
          <Button
            variant="tertiary"
            startContent={<ArrowLeft size={16} />}
            onPress={() => navigate(tenantPath('/platform-team/enterprise/monitoring/log-files'))}
            size="sm"
          >
            {t('enterprise.log_viewer_back')}
          </Button>
        }
      />

      {/* Controls Bar */}
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-4 p-4">
          <Select
            label={t('enterprise.label_lines')}
            selectedKeys={[String(lines)]}
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0];
              if (val) setLines(Number(val));
            }}
            size="sm"
            variant="secondary"
            className="w-36"
          >
            {LINE_OPTION_KEYS.map((key) => (
              <SelectItem key={key} id={key}>{t(`enterprise.log_lines_${key}`)}</SelectItem>
            ))}
          </Select>

          <Select
            label={t('enterprise.label_level')}
            selectedKeys={[level]}
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0];
              if (val) setLevel(String(val));
            }}
            size="sm"
            variant="secondary"
            className="w-40"
          >
            {LEVEL_OPTION_KEYS.map((key) => (
              <SelectItem key={key} id={key}>{t(`enterprise.log_level_${key.toLowerCase()}`)}</SelectItem>
            ))}
          </Select>

          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              isSelected={autoRefresh}
              onValueChange={setAutoRefresh}
            />
            <span className="text-sm text-muted">{t('enterprise.auto_refresh_label')}</span>
          </div>

          <div className="flex-1" />

          <Button
            variant="secondary"
            startContent={<RefreshCw size={14} />}
            onPress={loadData}
            size="sm"
          >
            {t('enterprise.refresh')}
          </Button>
          <Button
            variant="secondary"
            startContent={<Download size={14} />}
            size="sm"
            isDisabled={!content}
            onPress={handleDownload}
          >
            {t('log_files_labels.download')}
          </Button>
          <Button
            variant="danger"
            startContent={<Trash2 size={14} />}
            onPress={() => setClearModalOpen(true)}
            size="sm"
          >
            {t('enterprise.btn_clear')}
          </Button>
        </CardBody>
      </Card>

      {/* Log Content */}
      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : content && content.content.length > 0 ? (
        <Card className="bg-surface-secondary">
          <CardBody className="p-0 overflow-x-auto">
            <pre className="text-xs font-mono leading-relaxed p-4">
              {content.content.map((line) => {
                const detectedLevel = line.level?.toUpperCase() || detectLevel(line.text);
                const colorClass = levelColorClass(detectedLevel);
                return (
                  <div key={line.line} className="flex hover:bg-surface">
                    <span className="inline-block w-12 text-right pr-3 text-muted select-none shrink-0">
                      {line.line}
                    </span>
                    <span className={colorClass}>{line.text}</span>
                  </div>
                );
              })}
            </pre>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="py-16 text-center">
            <p className="text-muted">{t('enterprise.no_log_file_found')}</p>
          </CardBody>
        </Card>
      )}

      {/* Clear Confirmation Modal */}
      <Modal isOpen={clearModalOpen} onClose={() => setClearModalOpen(false)}>
        <ModalContent>
          <ModalHeader>{t('enterprise.clear_log_file')}</ModalHeader>
          <ModalBody>
            <p className="text-muted">
              {t('enterprise.clear_log_confirm')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setClearModalOpen(false)}>
              {t('enterprise.btn_cancel_modal')}
            </Button>
            <Button variant="danger" onPress={handleClear} isLoading={clearing}>
              {t('enterprise.btn_clear_file')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default LogFileViewer;
