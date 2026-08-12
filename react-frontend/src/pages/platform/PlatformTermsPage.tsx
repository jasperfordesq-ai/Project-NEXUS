// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/* eslint-disable i18next/no-literal-string --
 * Platform-level legal documents are canonically English. Localized versions,
 * if produced, must be authored by lawyers (not machine-translated) and
 * served from a separate per-locale source. Disabling the i18n literal rule
 * here is intentional — see audit 2026-05-10.
 */

import FileText from 'lucide-react/icons/file-text';
import { useTranslation } from 'react-i18next';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  PlatformLegalPage,
  type PlatformLegalSection,
} from '@/components/legal/PlatformLegalPage';

const sections: PlatformLegalSection[] = [
  /* ── 1. Introduction & Acceptance ── */
  {
    id: 'introduction',
    title: '',
    content: (
      <>
        <p>
          Project NEXUS is an open-source, multi-tenant community platform
          licensed under the{' '}
          <strong>GNU Affero General Public Licence v3.0 or later (AGPL-3.0-or-later)</strong>.
          It provides the software infrastructure that powers independently
          operated communities (known as "tenants"), enabling them to coordinate
          timebanking, volunteering, and other forms of community exchange.
        </p>
        <p>
          By accessing, browsing, or using any community powered by the Project
          NEXUS platform — whether as a Member, Operator, or casual visitor — you
          acknowledge that you have read, understood, and agree to be bound by
          these Platform Terms of Service ("Terms"). If you do not agree with
          these Terms, you must discontinue use of the Platform immediately.
        </p>
        <p>
          These Terms govern the relationship between you and the Platform
          provider. They <strong>supplement</strong> — but do not replace — any
          terms, policies, or agreements established by your Community Operator.
          Your Community Operator may impose additional obligations or
          restrictions beyond those set out here.
        </p>
        <p>
          In the event of a conflict between these Platform Terms and any terms
          established by your Community Operator, these Platform Terms shall
          prevail with respect to platform-level matters (such as acceptable use
          of the infrastructure, limitation of liability of the Platform
          provider, and intellectual property). For community-level matters (such
          as membership criteria, exchange rules, and local policies), the
          Operator's terms apply.
        </p>
      </>
    ),
  },

  /* ── 2. Platform Provider Identity ── */
  {
    id: 'provider',
    title: '',
    content: (
      <>
        <p>
          The Project NEXUS platform is operated and maintained by{' '}
          <strong>Jasper Ford</strong> ("Platform Provider", "we", "us", or
          "our").
        </p>
        <ul>
          <li>
            <strong>Website:</strong>{' '}
            <a
              href="https://project-nexus.ie"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              project-nexus.ie
            </a>
          </li>
          <li>
            <strong>Licence:</strong> AGPL-3.0-or-later
          </li>
          <li>
            <strong>Source Code:</strong>{' '}
            <a
              href="https://github.com/jasperfordesq-ai/Project-NEXUS"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              github.com/jasperfordesq-ai/Project-NEXUS
            </a>
          </li>
        </ul>
        <p>
          The Platform Provider is responsible for the development, hosting, and
          maintenance of the core platform software and shared infrastructure. The
          Platform Provider does <strong>not</strong> operate, manage, or control
          any individual Community or tenant hosted on the Platform.
        </p>
      </>
    ),
  },

  /* ── 3. Definitions ── */
  {
    id: 'definitions',
    title: '',
    content: (
      <>
        <p>
          The following definitions apply throughout these Terms:
        </p>
        <ul>
          <li>
            <strong>"Platform"</strong> means the Project NEXUS software
            infrastructure, including the hosted application, APIs, databases,
            and all associated services operated by the Platform Provider.
          </li>
          <li>
            <strong>"Community"</strong> or <strong>"Tenant"</strong> means an
            independently operated timebank, community group, or organisation
            that uses the Platform to facilitate its activities.
          </li>
          <li>
            <strong>"Operator"</strong> means the person, group, or organisation
            responsible for administering a Community on the Platform, including
            its appointed administrators and coordinators.
          </li>
          <li>
            <strong>"Member"</strong> means an individual who has registered for
            an account with a Community on the Platform.
          </li>
          <li>
            <strong>"Time Credits"</strong> means the unit of exchange used
            within the Platform's timebanking system to record and balance
            service exchanges between Members. Time Credits are{' '}
            <strong>not</strong> legal tender, are <strong>not</strong> financial
            instruments, do <strong>not</strong> constitute a currency, and carry{' '}
            <strong>no</strong> monetary value. They exist solely as a record of
            time-based contributions within a Community.
          </li>
        </ul>
      </>
    ),
  },

  /* ── 4. Operator Responsibilities ── */
  {
    id: 'operator-responsibilities',
    title: '',
    content: (
      <>
        <p>
          Community Operators are <strong>independently and solely responsible</strong>{' '}
          for all aspects of their Community's operation. The Platform provides
          the technology infrastructure; Operators provide the governance,
          oversight, and legal compliance.
        </p>
        <p>
          Operators must ensure compliance with all laws and regulations
          applicable in the jurisdiction(s) in which their Community operates.
          Without limitation, Operators are solely responsible for:
        </p>
        <ul>
          <li>
            <strong>Member identity verification</strong> — confirming the
            identity of individuals who register with their Community
          </li>
          <li>
            <strong>Background and safeguarding checks</strong> — obtaining
            Garda vetting, DBS checks, or equivalent background screening as
            required by applicable law, particularly where Members may interact
            with vulnerable persons
          </li>
          <li>
            <strong>Content moderation</strong> — monitoring, reviewing, and
            removing user-generated content that violates applicable law or
            Community policies
          </li>
          <li>
            <strong>Data protection compliance</strong> — fulfilling all
            obligations under applicable data protection legislation (including
            GDPR, CCPA, and equivalent frameworks), acting as the data
            controller for Member personal data
          </li>
          <li>
            <strong>Safeguarding vulnerable members</strong> — implementing
            appropriate safeguarding policies and procedures for children,
            elderly persons, and other vulnerable individuals
          </li>
          <li>
            <strong>Insurance and liability</strong> — obtaining and maintaining
            appropriate insurance coverage for their Community's activities
          </li>
          <li>
            <strong>Tax obligations</strong> — understanding and fulfilling any
            tax reporting or compliance requirements arising from their
            Community's activities
          </li>
        </ul>
        <p>
          The Platform does <strong>not</strong> verify, endorse, supervise,
          audit, or certify any Operator. The Platform makes{' '}
          <strong>no representations or warranties whatsoever</strong> regarding
          any Operator's qualifications, compliance status, suitability, or
          fitness for purpose.
        </p>
        <p>
          By operating a Community on the Platform, Operators explicitly
          acknowledge and accept full responsibility for their Community's legal
          compliance, governance, and the safety and welfare of their Members.
        </p>
      </>
    ),
  },

  /* ── 5. Acceptable Use ── */
  {
    id: 'acceptable-use',
    title: '',
    content: (
      <>
        <p>
          You agree to use the Platform only for lawful purposes and in
          accordance with these Terms. The following activities are strictly
          prohibited:
        </p>
        <ul>
          <li>
            Using the Platform in connection with any <strong>illegal activity</strong>,
            including but not limited to fraud, money laundering, terrorism
            financing, tax evasion, or the facilitation of any criminal offence
          </li>
          <li>
            Attempting to <strong>circumvent security measures</strong>, rate
            limits, access controls, authentication mechanisms, or any other
            technical safeguards implemented by the Platform
          </li>
          <li>
            Conducting <strong>automated scraping</strong>, bot-driven access,
            data harvesting, or denial-of-service attacks against the Platform
            or any Community hosted on it
          </li>
          <li>
            Distributing <strong>malware, viruses</strong>, ransomware, spyware,
            or any other harmful code through or to the Platform
          </li>
          <li>
            <strong>Impersonating</strong> other users, Operators, the Platform
            Provider, or any other person or entity
          </li>
          <li>
            Using the Platform to send unsolicited bulk communications
            (<strong>spam</strong>), phishing messages, or other deceptive
            communications
          </li>
        </ul>
        <p>
          Time Credits exist solely as a record of time-based community
          exchanges. Time Credits have <strong>no monetary value</strong> and may
          not be sold, traded, bartered, auctioned, or converted to any form of
          currency, cryptocurrency, or financial instrument.
        </p>
        <p>
          The Platform Provider reserves the right to suspend or terminate access
          for any user or Community found to be in violation of this Acceptable
          Use policy, without prior notice.
        </p>
      </>
    ),
  },

  /* ── 6. Intellectual Property ── */
  {
    id: 'intellectual-property',
    title: '',
    content: (
      <>
        <p>
          The Project NEXUS platform software is released under the{' '}
          <strong>GNU Affero General Public Licence v3.0 or later
          (AGPL-3.0-or-later)</strong>. You may use, modify, and distribute the
          software in accordance with the terms of that licence. A copy of the
          licence is included in the source repository and the NOTICE file.
        </p>
        <p>
          The <strong>"Project NEXUS"</strong> name, logo, visual branding, and
          associated trademarks are the property of the Platform Provider and are{' '}
          <strong>not</strong> covered by the AGPL licence. Use of these marks
          requires prior written permission from the Platform Provider, except as
          required for attribution under the AGPL licence terms.
        </p>
        <p>
          User-generated content (including listings, messages, reviews, profile
          information, and uploaded media) remains the intellectual property of
          the user who created it. By uploading or posting content to the
          Platform, you grant the Platform and your Community Operator a
          non-exclusive, worldwide, royalty-free licence to display, reproduce,
          and distribute that content within the Platform for the purpose of
          providing the service.
        </p>
        <p>
          Contributors to the Project NEXUS open-source project are acknowledged
          in the NOTICE file and the About page, in accordance with the
          attribution requirements of the AGPL licence.
        </p>
      </>
    ),
  },

  /* ── 7. Limitation of Liability ── */
  {
    id: 'limitation-of-liability',
    title: '',
    content: (
      <>
        <p>
          <strong>
            THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTY
            OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING BUT
            NOT LIMITED TO THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR
            A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
          </strong>
        </p>
        <p>
          To the maximum extent permitted by applicable law, the Platform
          Provider shall not be liable for any of the following:
        </p>
        <ul>
          <li>
            The <strong>quality, safety, legality, or suitability</strong> of any
            service exchanged between Members
          </li>
          <li>
            <strong>Disputes</strong> arising between Members, or between Members
            and Operators, regardless of the nature of the dispute
          </li>
          <li>
            Any Operator's <strong>failure to comply</strong> with applicable
            laws, regulations, or standards, including but not limited to data
            protection, safeguarding, and employment laws
          </li>
          <li>
            <strong>Data loss, corruption, or unauthorised access</strong> to
            data, whether caused by technical failure, security breach, or human
            error
          </li>
          <li>
            <strong>Service interruptions, downtime</strong>, or degraded
            performance, whether planned or unplanned
          </li>
          <li>
            The <strong>actions, omissions, or conduct</strong> of any third
            party, including but not limited to Members, Operators, and
            third-party service providers
          </li>
          <li>
            Any <strong>consequential, incidental, indirect, special, or punitive
            damages</strong>, including loss of profits, revenue, data, goodwill,
            or business opportunity, even if the Platform Provider has been
            advised of the possibility of such damages
          </li>
        </ul>
        <p>
          <strong>
            THE PLATFORM PROVIDER'S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR
            RELATING TO THESE TERMS OR YOUR USE OF THE PLATFORM SHALL NOT EXCEED
            THE TOTAL AMOUNT PAID BY YOU TO THE PLATFORM PROVIDER IN THE TWELVE
            (12) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE
            CLAIM.
          </strong>{' '}
          For the avoidance of doubt, as the Platform is provided as open-source
          software at no charge, this amount is typically zero.
        </p>
        <p>
          Nothing in these Terms excludes or limits liability for death or
          personal injury caused by negligence, fraud, or any other liability
          that cannot be excluded or limited by law.
        </p>
      </>
    ),
  },

  /* ── 8. Indemnification ── */
  {
    id: 'indemnification',
    title: '',
    content: (
      <>
        <p>
          You agree to indemnify, defend, and hold harmless the Platform
          Provider, its contributors, collaborators, and affiliates from and
          against any and all claims, demands, damages, losses, liabilities,
          costs, and expenses (including reasonable legal fees) arising out of or
          relating to:
        </p>
        <ul>
          <li>
            Your <strong>use of the Platform</strong>, including any activity
            conducted through your account
          </li>
          <li>
            Your <strong>violation of these Terms</strong> or any applicable law
            or regulation
          </li>
          <li>
            Your <strong>Community's operation</strong>, if you are an Operator,
            including any claims by Members or third parties relating to your
            Community's activities, policies, or conduct
          </li>
          <li>
            Any <strong>content you upload</strong>, post, transmit, or
            distribute through the Platform
          </li>
          <li>
            Any <strong>infringement of third-party rights</strong>, including
            intellectual property, privacy, or contractual rights
          </li>
        </ul>
        <p>
          This indemnification obligation mirrors and supplements the
          indemnification provisions set out in the NOTICE file, in accordance
          with Section 7(f) of the AGPL-3.0-or-later licence.
        </p>
      </>
    ),
  },

  /* ── 9. Data Processing ── */
  {
    id: 'data-processing',
    title: '',
    content: (
      <>
        <p>
          The Platform processes data in a structured, role-based manner:
        </p>
        <ul>
          <li>
            <strong>Community Operators are data controllers.</strong> Operators
            determine the purposes and means of processing Member personal data
            within their Community. Operators are responsible for obtaining
            appropriate consent, providing privacy notices, and fulfilling data
            subject rights requests.
          </li>
          <li>
            <strong>The Platform Provider acts as a data processor</strong>{' '}
            (or sub-processor) with respect to Member personal data, processing
            it on the Operator's behalf to provide the platform service.
          </li>
        </ul>
        <p>
          The Platform collects and processes certain infrastructure-level data
          necessary for the operation, security, and improvement of the service.
          This includes server logs, error reports (via Sentry), performance
          metrics, and security audit trails. This infrastructure data is
          processed by the Platform Provider as an independent controller.
        </p>
        <p>
          International data transfers may occur through the Platform's
          sub-processors, including but not limited to Cloudflare (CDN and
          security), Sentry (error monitoring), and Pusher (real-time
          communications). These transfers are conducted in accordance with
          applicable data transfer mechanisms.
        </p>
        <p>
          For full details on platform-level data processing, please refer to the{' '}
          <strong>Platform Privacy Policy</strong>.
        </p>
      </>
    ),
  },

  /* ── 10. Termination ── */
  {
    id: 'termination',
    title: '',
    content: (
      <>
        <p>
          The Platform Provider may suspend or terminate your access to the
          Platform — or any Community Operator's use of the Platform — at any
          time and for any reason, including but not limited to:
        </p>
        <ul>
          <li>
            Violation of these Terms, including the Acceptable Use policy
          </li>
          <li>
            Conduct that poses a risk to the security, integrity, or
            availability of the Platform
          </li>
          <li>
            Receipt of a valid legal order, regulatory directive, or
            law-enforcement request
          </li>
          <li>
            Extended inactivity or abandonment of a Community
          </li>
        </ul>
        <p>
          Community Operators may terminate their Community's use of the Platform
          at any time by contacting the Platform Provider. Upon termination, the
          Operator's data will be handled in accordance with the Platform Privacy
          Policy, including any applicable data retention periods.
        </p>
        <p>
          The following provisions shall survive termination of these Terms and
          continue in full force and effect:{' '}
          <strong>
            Limitation of Liability, Indemnification, Intellectual Property,
            Governing Law,
          </strong>{' '}
          and any other provisions that by their nature are intended to survive
          termination.
        </p>
      </>
    ),
  },

  /* ── 11. Changes to Terms ── */
  {
    id: 'changes',
    title: '',
    content: (
      <>
        <p>
          The Platform Provider reserves the right to modify, amend, or replace
          these Terms at any time. When changes are made, the effective date at
          the top of this document will be updated accordingly.
        </p>
        <p>
          For <strong>material changes</strong> — those that substantively alter
          your rights or obligations — the Platform Provider will make reasonable
          efforts to provide advance notice through the Platform, such as a
          banner notification, an update to the version history page, or
          notification to Community Operators.
        </p>
        <p>
          Your continued use of the Platform after the effective date of any
          revised Terms constitutes your acceptance of and agreement to the
          updated Terms. If you do not agree with the revised Terms, you must
          discontinue use of the Platform.
        </p>
        <p>
          It is your responsibility to review these Terms periodically to ensure
          you are aware of any changes. The effective date at the top of this
          document indicates when these Terms were last updated.
        </p>
      </>
    ),
  },

  /* ── 12. Governing Law ── */
  {
    id: 'governing-law',
    title: '',
    content: (
      <>
        <p>
          These Terms and any dispute or claim arising out of or in connection
          with them (including non-contractual disputes or claims) shall be
          governed by and construed in accordance with the <strong>laws of
          Ireland</strong>.
        </p>
        <p>
          Any dispute arising under or in relation to these Terms shall be
          subject to the <strong>exclusive jurisdiction of the courts of
          Ireland</strong>. You irrevocably submit to the jurisdiction of those
          courts and waive any objection to proceedings in such courts on the
          grounds of venue or on the grounds that the proceedings have been
          brought in an inconvenient forum.
        </p>
        <p>
          If any provision of these Terms is found by a court of competent
          jurisdiction to be invalid, illegal, or unenforceable, that provision
          shall be severed from these Terms, and the remaining provisions shall
          continue in full force and effect. The invalid provision shall be
          modified to the minimum extent necessary to make it valid and
          enforceable while preserving its original intent.
        </p>
        <p>
          The failure of the Platform Provider to enforce any right or provision
          of these Terms shall not constitute a waiver of that right or
          provision.
        </p>
      </>
    ),
  },
];

export function PlatformTermsPage() {
  const { t } = useTranslation('legal');
  usePageTitle(t('platform_terms.page_title'));

  const crossLinks = [
    { label: t('platform_terms.link_privacy'), to: '/platform/privacy' },
    { label: t('platform_terms.link_disclaimer'), to: '/platform/disclaimer' },
  ];
  const localizedSections = sections.map((section) => ({
    ...section,
    title: t(`platform_terms.sections.${section.id}`),
  }));

  return (
    <>
      <PageMeta title={t('page_meta.platform_terms.title')} description={t('page_meta.platform_terms.description')} />
      <PlatformLegalPage
        title={t('platform_terms.title')}
        subtitle={t('platform_terms.subtitle')}
        icon={FileText}
        effectiveDate="1 March 2026"
        sections={localizedSections}
        crossLinks={crossLinks}
      />
    </>
  );
}

export default PlatformTermsPage;
