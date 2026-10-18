// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Reminder emails — what the volunteering reminder jobs have sent recently,
 * with a filter by reminder type, and (for super admins) a button to run the
 * due shift reminders now.
 *
 * The reminder SETTINGS are not here: since 2026-10-18 they are ordinary
 * volunteering configuration, edited in the Module Configuration window
 * (sidebar: Volunteering → Settings). This panel is the operational half that
 * used to share the old settings page with them.
 */

import { useState, useCallback, useEffect } from 'react';
import Clock from 'lucide-react/icons/clock';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Send from 'lucide-react/icons/send';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardBody,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  useDisclosure,
} from '@/components/ui';
import { useAuth, useToast } from '@/contexts';
import { getFormattingLocale } from '@/lib/helpers';
import { isSuperAdminUser } from '@/lib/access';
import { adminVolunteering } from '../../api/adminApi';

interface DeliveryLog {
  id: number;
  user_name: string;
  user_avatar: string | null;
  reminder_type: string;
  channel: string;
  sent_at: string;
}

interface DeliveryStats {
  total_sent: number;
  by_channel: Record<string, number>;
  by_type: Record<string, number>;
}

const REMINDER_TYPES = ['pre_shift', 'post_shift_feedback', 'lapsed_volunteer', 'credential_expiry', 'training_expiry'] as const;

interface ReminderEmailsPanelProps {
  /** Bump to make the panel reload (the Overview's Refresh button does). */
  refreshKey?: number;
}

export function ReminderEmailsPanel({ refreshKey = 0 }: ReminderEmailsPanelProps) {
  const { t } = useTranslation('admin_volunteering');
  const toast = useToast();
  const { user } = useAuth();
  // The server lets any admin run the job (AdminVolunteerController::sendShiftReminders);
  // the button is kept to super admins so a community admin is not handed a
  // "send email to everyone" control by accident.
  const canRunReminderJobs = isSuperAdminUser(user);

  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [stats, setStats] = useState<DeliveryStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [running, setRunning] = useState(false);
  const { isOpen: isConfirmOpen, onOpen: onConfirmOpen, onClose: onConfirmClose } = useDisclosure();

  const loadLogs = useCallback(async (type?: string) => {
    setLoading(true);
    try {
      const res = await adminVolunteering.getReminderLogs({ type: type || undefined, per_page: 10 });
      if (res.success && res.data) {
        setLogs(Array.isArray(res.data) ? (res.data as DeliveryLog[]) : []);
        const meta = res.meta as { stats?: DeliveryStats } | undefined;
        if (meta?.stats) setStats(meta.stats);
      }
    } catch {
      setLogs([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadLogs(filterType);
    // refreshKey is the Overview's "reload everything" signal.
  }, [loadLogs, filterType, refreshKey]);

  const handleRunNow = async () => {
    setRunning(true);
    try {
      const res = await adminVolunteering.sendShiftReminders();
      if (!res.success) {
        throw new Error('send_shift_reminders_failed');
      }
      onConfirmClose();
      toast.success(
        t('volunteering.reminder_job_sent', {
          count: (res.data as { reminders_sent?: number } | undefined)?.reminders_sent ?? 0,
        }),
      );
      void loadLogs(filterType);
    } catch {
      toast.error(t('volunteering.reminder_job_failed'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <Clock size={18} />
          {t('volunteering.recent_deliveries')}
        </h3>
        <div className="flex items-center gap-2">
          {stats && (
            <Chip size="sm" variant="soft" color="default">
              {t('volunteering.delivery_total_sent', { count: stats.total_sent })}
            </Chip>
          )}
          {canRunReminderJobs && (
            <Button variant="secondary" size="sm" startContent={<Send size={14} />} onPress={onConfirmOpen} isLoading={running}>
              {t('volunteering.run_due_reminders')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-2 rounded-2xl border border-divider/70 bg-surface p-3 shadow-sm shadow-black/[0.03]">
        <Select
          label={t('volunteering.filter_type')}
          size="sm"
          variant="secondary"
          className="w-56"
          selectedKeys={filterType ? [filterType] : []}
          onSelectionChange={(keys) => setFilterType((Array.from(keys)[0] as string) || '')}
        >
          <SelectItem key="" id="">{t('volunteering.tab_all')}</SelectItem>
          {REMINDER_TYPES.map((type) => (
            <SelectItem key={type} id={type}>{t(`volunteering.reminder_${type}`)}</SelectItem>
          ))}
        </Select>
      </div>

      {loading ? (
        <Card className="border border-divider/70 bg-surface-secondary/50">
          <CardBody className="flex justify-center p-6">
            <div className="flex items-center gap-2 text-muted">
              <RefreshCw size={16} className="animate-spin" />
              <span className="text-sm">{t('volunteering.loading')}</span>
            </div>
          </CardBody>
        </Card>
      ) : logs.length === 0 ? (
        <Card className="border border-divider/70 bg-surface-secondary/50">
          <CardBody className="p-6 text-center">
            <Clock size={32} className="mx-auto mb-3 text-muted" />
            <p className="text-sm text-muted">{t('volunteering.no_delivery_logs')}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-1">
          {logs.map((log) => (
            <Card key={log.id} className="border border-divider/70 p-0 shadow-sm shadow-black/[0.02]">
              <CardBody className="p-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">{log.user_name}</span>
                  </div>
                  <Chip size="sm" variant="soft" color="accent">
                    {t(`volunteering.reminder_${log.reminder_type}`)}
                  </Chip>
                  <span className="whitespace-nowrap text-xs text-muted">
                    {log.sent_at ? new Date(log.sent_at).toLocaleString(getFormattingLocale()) : ''}
                  </span>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {canRunReminderJobs && (
        <Modal isOpen={isConfirmOpen} onClose={onConfirmClose} size="sm">
          <ModalContent>
            <ModalHeader>{t('volunteering.run_reminder_job_title')}</ModalHeader>
            <ModalBody>
              <p className="text-foreground">{t('volunteering.run_reminder_job_confirm')}</p>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onPress={onConfirmClose}>{t('volunteering.cancel')}</Button>
              <Button startContent={<Send size={14} />} onPress={handleRunNow} isLoading={running}>
                {t('volunteering.confirm_run_reminders')}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </div>
  );
}

export default ReminderEmailsPanel;
