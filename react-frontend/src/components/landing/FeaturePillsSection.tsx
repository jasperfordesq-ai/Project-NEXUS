// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { motion } from '@/lib/motion';
import Clock from 'lucide-react/icons/clock';
import Users from 'lucide-react/icons/users';
import Zap from 'lucide-react/icons/zap';
import { useTranslation } from 'react-i18next';
import { getIcon } from './iconMap';
import type { LucideIcon } from 'lucide-react';
import type { FeaturePillsContent } from '@/types';

interface ResolvedPill {
  Icon: LucideIcon;
  title: string;
  description: string;
}

const defaultIcons: LucideIcon[] = [Clock, Users, Zap];

interface FeaturePillsSectionProps {
  content?: FeaturePillsContent;
}

export function FeaturePillsSection({ content }: FeaturePillsSectionProps) {
  const { t } = useTranslation('public');

  const pills: ResolvedPill[] =
    content?.items && content.items.length > 0
      ? content.items.map((item, index) => ({
          Icon: getIcon(item.icon, defaultIcons[index % defaultIcons.length]),
          title: item.title,
          description: item.description,
        }))
      : [
          {
            Icon: Clock,
            title: t('home.features.0.title'),
            description: t('home.features.0.description'),
          },
          {
            Icon: Users,
            title: t('home.features.1.title'),
            description: t('home.features.1.description'),
          },
          {
            Icon: Zap,
            title: t('home.features.2.title'),
            description: t('home.features.2.description'),
          },
        ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto px-4 sm:px-6"
    >
      {pills.map((pill, index) => (
        <motion.div
          key={pill.title}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: index * 0.1 }}
          className="flex items-center gap-3 p-4 rounded-2xl glass-card backdrop-blur-lg"
        >
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 flex items-center justify-center">
            <pill.Icon className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
          </div>
          <div className="text-left">
            <p className="font-medium text-theme-primary">{pill.title}</p>
            <p className="text-sm text-theme-subtle">{pill.description}</p>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
