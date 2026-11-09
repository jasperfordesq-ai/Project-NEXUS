// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';import ArrowRight from 'lucide-react/icons/arrow-right';
import { useTranslation } from 'react-i18next';
import { useTenant, useAuth } from '@/contexts';
import type { CtaContent } from '@/types';

interface CtaSectionProps {
  content?: CtaContent;
}

export function CtaSection({ content }: CtaSectionProps) {
  const { t } = useTranslation('public');
  const { tenantPath } = useTenant();
  const { isAuthenticated } = useAuth();

  // Only render for unauthenticated visitors
  if (isAuthenticated) {
    return null;
  }

  const title = content?.title || t('home.cta_section.title');
  const description = content?.description || t('home.cta_section.description');
  const buttonText = content?.button_text || t('home.cta_section.button');
  const buttonLink = content?.button_link || '/register';

  return (
    <section aria-labelledby="cta-heading" className="py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="p-6 sm:p-8 lg:p-12 rounded-3xl bg-gradient-to-br from-accent/10 to-accent-gradient-end/10 border border-theme-default"
        >
          <h2 id="cta-heading" className="text-3xl sm:text-4xl font-bold text-theme-primary mb-4">
            {title}
          </h2>
          <p className="text-theme-muted mb-8 max-w-xl mx-auto">
            {description}
          </p>
          <Button
            as={Link}
            to={tenantPath(buttonLink)}
            size="lg"
            className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white font-semibold px-10"
            endContent={<ArrowRight className="w-5 h-5" aria-hidden="true" />}
          >
            {buttonText}
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
