// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { GlassCard } from '@/components/ui/GlassCard';
import { motion } from '@/lib/motion';
import UserPlus from 'lucide-react/icons/user-plus';
import Search from 'lucide-react/icons/search';
import Handshake from 'lucide-react/icons/handshake';
import Coins from 'lucide-react/icons/coins';
import { useTranslation } from 'react-i18next';
import { getIcon } from './iconMap';
import type { LucideIcon } from 'lucide-react';
import type { HowItWorksContent } from '@/types';

interface ResolvedStep {
  Icon: LucideIcon;
  title: string;
  description: string;
  color: string;
}

const FALLBACK_META = { icon: UserPlus, color: 'from-accent to-blue-500' } as const;
const defaultStepMeta: { icon: LucideIcon; color: string }[] = [
  FALLBACK_META,
  { icon: Search, color: 'from-accent to-pink-500' },
  { icon: Handshake, color: 'from-cyan-500 to-teal-500' },
  { icon: Coins, color: 'from-amber-500 to-orange-500' },
];

interface HowItWorksSectionProps {
  content?: HowItWorksContent;
}

export function HowItWorksSection({ content }: HowItWorksSectionProps) {
  const { t } = useTranslation('public');

  const title = content?.title || t('home.how_it_works.title');
  const subtitle = content?.subtitle || t('home.how_it_works.subtitle');

  const steps: ResolvedStep[] =
    content?.steps && content.steps.length > 0
      ? content.steps.map((step, index) => {
          const meta = defaultStepMeta[index] ?? FALLBACK_META;
          return {
            Icon: getIcon(step.icon, meta.icon),
            title: step.title,
            description: step.description,
            color: meta.color,
          };
        })
      : [
          {
            Icon: UserPlus,
            title: t('home.how_it_works.steps.0.title'),
            description: t('home.how_it_works.steps.0.description'),
            color: 'from-accent to-blue-500',
          },
          {
            Icon: Search,
            title: t('home.how_it_works.steps.1.title'),
            description: t('home.how_it_works.steps.1.description'),
            color: 'from-accent to-pink-500',
          },
          {
            Icon: Handshake,
            title: t('home.how_it_works.steps.2.title'),
            description: t('home.how_it_works.steps.2.description'),
            color: 'from-cyan-500 to-teal-500',
          },
          {
            Icon: Coins,
            title: t('home.how_it_works.steps.3.title'),
            description: t('home.how_it_works.steps.3.description'),
            color: 'from-amber-500 to-orange-500',
          },
        ];

  return (
    <section id="features" aria-labelledby="how-it-works-heading" className="py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2 id="how-it-works-heading" className="text-2xl sm:text-3xl font-bold text-theme-primary mb-3">
            {title}
          </h2>
          <p className="text-theme-muted max-w-lg mx-auto">
            {subtitle}
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
            >
              <GlassCard className="p-6 h-full text-center relative group motion-safe:hover:scale-[1.02] motion-safe:transition-transform">
                <div className="absolute top-2 right-2 w-8 h-8 rounded-full bg-gradient-to-br from-accent-strong to-accent-strong-end flex items-center justify-center text-white text-sm font-bold shadow-lg">
                  {index + 1}
                </div>
                <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br ${step.color} mb-4`}>
                  <step.Icon className="w-7 h-7 text-white" aria-hidden="true" />
                </div>
                <h3 className="font-semibold text-theme-primary mb-2">{step.title}</h3>
                <p className="text-sm text-theme-muted">{step.description}</p>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
