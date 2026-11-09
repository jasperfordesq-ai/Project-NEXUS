// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Renders a custom legal document fetched from the API.
 * Used by TermsPage, PrivacyPage, AccessibilityPage, CookiesPage
 * when the tenant has a custom document configured.
 *
 * Parses the HTML content to extract section headings for a table of
 * contents, then renders each section inside its own GlassCard with
 * staggered entrance animations — matching the visual quality of the
 * handcrafted default legal pages.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';
import { Chip } from '@/components/ui/Chip';
import { sanitizeRichText } from '@/lib/sanitize';
import FileText from 'lucide-react/icons/file-text';
import CalendarDays from 'lucide-react/icons/calendar-days';
import Send from 'lucide-react/icons/send';
import List from 'lucide-react/icons/list';
import ChevronRight from 'lucide-react/icons/chevron-right';
import History from 'lucide-react/icons/history';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useTenant } from '@/contexts';
import type { LegalDocument } from '@/hooks/useLegalDocument';

// ─────────────────────────────────────────────────────────────────────────────
// Animation variants
// ─────────────────────────────────────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Section parsing
// ─────────────────────────────────────────────────────────────────────────────

interface Section {
  id: string;
  title: string;
  /** Display title with any leading number prefix stripped */
  displayTitle: string;
  /** Original numeric prefix (e.g. "1") if present, otherwise null */
  numericPrefix: string | null;
  html: string;
}

/**
 * Extract a leading numeric prefix from a section title.
 * Matches patterns like "1. Title", "12. Title", "1) Title".
 * Returns [numericPrefix, cleanedTitle] or [null, originalTitle].
 */
function parseNumberedTitle(title: string): [string | null, string] {
  const match = title.match(/^(\d+)[.)]\s+(.+)$/);
  if (match) return [match[1] ?? null, match[2] ?? title];
  return [null, title];
}

function parseSections(html: string, introductionTitle: string): Section[] {
  // Split on <h2 ...>...</h2> while keeping the matched heading
  const parts = html.split(/(<h2[^>]*>[\s\S]*?<\/h2>)/i);
  const sections: Section[] = [];
  let currentTitle = '';
  let currentId = '';
  let currentHtml = '';

  // Check if there's meaningful content before the first h2
  const introHtml = parts[0]?.trim();
  const hasIntro = introHtml && !introHtml.match(/^<h2/i) && introHtml.length > 10;

  for (const part of parts) {
    const h2Match = part.match(/<h2[^>]*?(?:id="([^"]*)")?[^>]*>([\s\S]*?)<\/h2>/i);

    if (h2Match) {
      // Flush previous section
      if (currentTitle) {
        const [numericPrefix, displayTitle] = parseNumberedTitle(currentTitle);
        sections.push({ id: currentId, title: currentTitle, displayTitle, numericPrefix, html: currentHtml.trim() });
      }
      const rawTitle = (h2Match[2] ?? '').replace(/<[^>]+>/g, '').trim();
      currentTitle = rawTitle;
      currentId = h2Match[1] || slugify(rawTitle);
      currentHtml = '';
    } else {
      currentHtml += part;
    }
  }

  // Flush last section
  if (currentTitle) {
    const [numericPrefix, displayTitle] = parseNumberedTitle(currentTitle);
    sections.push({ id: currentId, title: currentTitle, displayTitle, numericPrefix, html: currentHtml.trim() });
  }

  // If there was content before the first h2, prepend as an intro section
  if (hasIntro) {
    sections.unshift({
      id: 'introduction',
      title: introductionTitle,
      displayTitle: introductionTitle,
      numericPrefix: null,
      html: introHtml,
    });
  }

  return sections;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Accent colour palettes — static classes so Tailwind won't purge them
// ─────────────────────────────────────────────────────────────────────────────

const ACCENT_STYLES = {
  blue: {
    gradientFrom: 'from-blue-500/20',
    gradientTo: 'to-cyan-500/20',
    icon: 'text-[var(--color-info)]',
    tocHover: 'hover:bg-blue-500/10',
    chipBg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    btnGradient: 'bg-gradient-to-r from-blue-500 to-cyan-600 text-white',
  },
  indigo: {
    gradientFrom: 'from-accent/20',
    gradientTo: 'to-accent-gradient-end/20',
    icon: 'text-accent dark:text-accent',
    tocHover: 'hover:bg-accent/10',
    chipBg: 'bg-accent/10 text-accent dark:text-accent',
    btnGradient: 'bg-gradient-to-r from-accent-strong to-accent-strong-end text-white',
  },
  purple: {
    gradientFrom: 'from-accent/20',
    gradientTo: 'to-pink-500/20',
    icon: 'text-accent dark:text-accent',
    tocHover: 'hover:bg-accent/10',
    chipBg: 'bg-accent/10 text-accent dark:text-accent',
    btnGradient: 'bg-gradient-to-r from-accent-strong to-pink-600 text-white',
  },
  emerald: {
    gradientFrom: 'from-emerald-500/20',
    gradientTo: 'to-teal-500/20',
    icon: 'text-emerald-500 dark:text-emerald-400',
    tocHover: 'hover:bg-emerald-500/10',
    chipBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    btnGradient: 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white',
  },
  amber: {
    gradientFrom: 'from-amber-500/20',
    gradientTo: 'to-orange-500/20',
    icon: 'text-[var(--color-warning)]',
    tocHover: 'hover:bg-amber-500/10',
    chipBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    btnGradient: 'bg-gradient-to-r from-amber-500 to-orange-600 text-white',
  },
};

/** Map document type → route slug for the versions page */
const TYPE_TO_SLUG: Record<string, string> = {
  terms: 'terms',
  privacy: 'privacy',
  cookies: 'cookies',
  accessibility: 'accessibility',
  community_guidelines: 'community-guidelines',
  acceptable_use: 'acceptable-use',
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  document: LegalDocument;
  accentColor?: keyof typeof ACCENT_STYLES;
}

export function CustomLegalDocument({ document: doc, accentColor = 'blue' }: Props) {
  const { t } = useTranslation('legal');
  const { tenantPath } = useTenant();
  const styles = ACCENT_STYLES[accentColor] ?? ACCENT_STYLES.blue;
  const introductionTitle = t('custom_document.introduction');
  const sections = useMemo(
    () => parseSections(doc.content, introductionTitle),
    [doc.content, introductionTitle],
  );

  // Check if the document already uses its own numbering scheme.
  // If most sections have numeric prefixes, use those instead of auto-numbering.
  const numberedCount = sections.filter((s) => s.numericPrefix !== null).length;
  const hasOwnNumbering = numberedCount > sections.length / 2;

  // Show TOC only when there are enough sections to justify it
  const showToc = sections.length >= 4;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="max-w-4xl mx-auto space-y-6"
    >
      {/* ── Hero Header ── */}
      <motion.div variants={itemVariants} className="text-center">
        <div
          className={`inline-flex p-4 rounded-2xl bg-gradient-to-br ${styles.gradientFrom} ${styles.gradientTo} mb-4`}
        >
          <FileText className={`w-10 h-10 ${styles.icon}`} aria-hidden="true" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-3">
          {doc.title}
        </h1>
        {(doc.effective_date || doc.version_number) && (
          <div className="flex items-center justify-center gap-2 mt-3 text-sm text-theme-subtle">
            {doc.effective_date && (
              <>
                <CalendarDays className="w-4 h-4" aria-hidden="true" />
                <span>
                  {t('custom.effective_label', { date: new Date(doc.effective_date).toLocaleDateString(getFormattingLocale(), {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  }) })}
                </span>
              </>
            )}
            {doc.version_number && (
              <Chip size="sm" variant="tertiary" color="default" className="ml-2">
                {t('version_history.version_number', { number: doc.version_number })}
              </Chip>
            )}
          </div>
        )}
        {doc.summary_of_changes && (
          <p className="mt-3 text-sm text-theme-muted max-w-xl mx-auto italic">
            {doc.summary_of_changes}
          </p>
        )}
      </motion.div>

      {/* ── Table of Contents ── */}
      {showToc && (
        <motion.div variants={itemVariants}>
          <GlassCard className="p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-theme-primary mb-3 flex items-center gap-2 uppercase tracking-wider">
              <List className="w-4 h-4" aria-hidden="true" />
              {t('custom.contents')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {sections.map((section, idx) => {
                const chipLabel = hasOwnNumbering
                  ? (section.numericPrefix ?? '·')
                  : String(idx + 1);
                return (
                  <Button
                    key={section.id}
                    variant="light"
                    onPress={() => scrollToSection(section.id)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm text-theme-muted transition-colors ${styles.tocHover} group min-h-11 w-full justify-start`}
                  >
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded text-[0.65rem] font-bold ${styles.chipBg} shrink-0`}
                    >
                      {chipLabel}
                    </span>
                    <span className="truncate group-hover:text-theme-primary transition-colors">
                      {hasOwnNumbering ? section.displayTitle : section.title}
                    </span>
                    <ChevronRight
                      className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
                      aria-hidden="true"
                    />
                  </Button>
                );
              })}
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* ── Content Sections ── */}
      {sections.map((section, idx) => {
        const chipLabel = hasOwnNumbering
          ? (section.numericPrefix ?? '·')
          : String(idx + 1);
        return (
          <motion.div key={section.id} variants={itemVariants} id={section.id}>
            <GlassCard className="p-6 sm:p-8">
              <h2 className="text-xl font-semibold text-theme-primary mb-4 flex items-center gap-2.5 pb-3 border-b border-(--border-default)">
                <Chip
                  size="sm"
                  variant="tertiary"
                  className={`${styles.chipBg} text-xs font-bold min-w-7`}
                >
                  {chipLabel}
                </Chip>
                {hasOwnNumbering ? section.displayTitle : section.title}
              </h2>
              <div
                className="legal-content"
                dangerouslySetInnerHTML={{ __html: sanitizeRichText(section.html) }}
              />
            </GlassCard>
          </motion.div>
        );
      })}

      {/* ── Version History + Contact CTA ── */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 sm:p-8">
          <div className="text-center space-y-4">
            {doc.has_previous_versions && (
              <div>
                <Link
                  to={tenantPath(`/${TYPE_TO_SLUG[doc.type] ?? doc.type}/versions`)}
                  className="inline-flex items-center gap-2 text-sm text-theme-muted hover:text-theme-primary transition-colors"
                >
                  <History className="w-4 h-4" aria-hidden="true" />
                  {t('custom.view_previous_versions')}
                </Link>
              </div>
            )}
            <div>
              <h2 className="text-xl font-semibold text-theme-primary mb-2">
                {t('custom.cta_title')}
              </h2>
              <p className="text-theme-muted text-sm mb-4">
                {t('custom.cta_body')}
              </p>
              <Button as={Link} to={tenantPath('/contact')}
                className={styles.btnGradient}
                startContent={<Send className="w-4 h-4" aria-hidden="true" />}
              >
                {t('custom.contact_us')}
              </Button>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}
