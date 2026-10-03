// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Empty State Component
 * Shown when a list or page has no data.
 *
 * Inside an AdminEmbed (the broker panel) it hands over to BrokerEmptyState
 * so embedded admin modules share the broker pages' empty-state look. The
 * admin panel is unaffected.
 */

import { Card, CardBody, Button } from '@/components/ui';
import Inbox from 'lucide-react/icons/inbox';
import type { LucideIcon } from 'lucide-react';
import { BrokerEmptyState } from '@/broker/components/BrokerEmptyState';
import { useAdminEmbed } from './AdminEmbedContext';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const { embedded } = useAdminEmbed();

  if (embedded) {
    return (
      <BrokerEmptyState
        icon={Icon}
        title={title}
        hint={description}
        action={
          actionLabel && onAction ? (
            <Button onPress={onAction}>{actionLabel}</Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
      <CardBody className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-secondary ring-1 ring-inset ring-divider">
          <Icon size={32} className="text-muted" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="mt-1 max-w-md text-sm text-muted">{description}</p>
        )}
        {actionLabel && onAction && (
          <Button
            className="mt-4"
            onPress={onAction}
          >
            {actionLabel}
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

export default EmptyState;
