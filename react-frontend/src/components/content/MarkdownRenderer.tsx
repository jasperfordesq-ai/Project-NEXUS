// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  variant?: "default" | "changelog" | "knowledgeBase";
}

const proseClasses = [
  "typography-prose typography-prose--sm max-w-none text-theme-primary",
].join(" ");

const changelogProseClasses = [
  "changelog-markdown",
  "typography-prose typography-prose--sm max-w-none text-theme-primary",
  "[&_h1]:sr-only",
  "[&_h2]:scroll-mt-24 [&_h2]:mt-12 [&_h2]:mb-4 [&_h2]:border-t [&_h2]:border-theme-default [&_h2]:pt-8 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-normal [&_h2]:text-theme-primary",
  "[&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:border-t-0 [&_h2:first-of-type]:pt-0",
  "[&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:inline-flex [&_h3]:rounded-md [&_h3]:border [&_h3]:border-theme-default [&_h3]:bg-theme-elevated [&_h3]:px-3 [&_h3]:py-1.5 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:uppercase [&_h3]:tracking-normal [&_h3]:text-theme-primary",
  "[&_ul]:my-4 [&_ul]:list-none [&_ul]:space-y-3 [&_ul]:pl-0",
  "[&_li]:my-0 [&_li]:rounded-md [&_li]:border [&_li]:border-theme-default [&_li]:bg-theme-card [&_li]:px-4 [&_li]:py-3 [&_li]:leading-7 [&_li]:text-theme-secondary [&_li]:shadow-sm",
  "[&_li>p]:my-0",
  "[&_code]:rounded-sm [&_code]:bg-theme-elevated [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_code]:font-medium [&_code]:text-accent",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-theme-default [&_pre]:bg-theme-elevated [&_pre]:p-4",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_hr]:my-8 [&_hr]:border-theme-default",
].join(" ");

const knowledgeBaseProseClasses = [
  "kb-markdown",
  "max-w-none text-theme-primary",
  "[&_h1]:mt-0 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-normal [&_h1]:text-theme-primary",
  "[&_h2]:scroll-mt-24 [&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:border-b [&_h2]:border-theme-default [&_h2]:pb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-normal [&_h2]:text-theme-primary",
  "[&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:tracking-normal [&_h3]:text-theme-primary",
  "[&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:tracking-normal [&_h4]:text-theme-primary",
  "[&_p]:my-4 [&_p]:text-base [&_p]:leading-8 [&_p]:text-theme-secondary",
  "[&_a]:font-medium [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-theme-primary",
  "[&_strong]:font-semibold [&_strong]:text-theme-primary",
  "[&_em]:text-theme-primary",
  "[&_ul]:my-5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6",
  "[&_ol]:my-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6",
  "[&_li]:pl-1 [&_li]:leading-8 [&_li]:text-theme-secondary [&_li::marker]:font-semibold [&_li::marker]:text-accent",
  "[&_li>p]:my-1",
  "[&_blockquote]:my-6 [&_blockquote]:rounded-md [&_blockquote]:border-l-4 [&_blockquote]:border-accent [&_blockquote]:bg-theme-elevated [&_blockquote]:px-4 [&_blockquote]:py-3 [&_blockquote_p]:my-0",
  "[&_code]:rounded-sm [&_code]:bg-theme-elevated [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.875em] [&_code]:font-medium [&_code]:text-accent",
  "[&_pre]:my-6 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-theme-default [&_pre]:bg-theme-elevated [&_pre]:p-4",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-theme-primary",
  "[&_table]:my-6 [&_table]:block [&_table]:min-w-full [&_table]:overflow-x-auto [&_table]:rounded-md [&_table]:border [&_table]:border-theme-default [&_table]:text-sm",
  "[&_thead]:bg-theme-elevated [&_th]:border-b [&_th]:border-theme-default [&_th]:px-4 [&_th]:py-3 [&_th]:text-left [&_th]:font-semibold [&_th]:text-theme-primary",
  "[&_td]:border-t [&_td]:border-theme-default [&_td]:px-4 [&_td]:py-3 [&_td]:align-top [&_td]:text-theme-secondary",
  "[&_img]:my-6 [&_img]:max-w-full [&_img]:rounded-md [&_img]:border [&_img]:border-theme-default",
  "[&_hr]:my-8 [&_hr]:border-theme-default",
].join(" ");

function classesForVariant(variant: MarkdownRendererProps["variant"]): string {
  switch (variant) {
    case "changelog":
      return changelogProseClasses;
    case "knowledgeBase":
      return knowledgeBaseProseClasses;
    default:
      return proseClasses;
  }
}

export function MarkdownRenderer({
  content,
  className,
  variant = "default",
}: MarkdownRendererProps) {
  const variantClasses = classesForVariant(variant);

  return (
    <div className={`${variantClasses}${className ? ` ${className}` : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => {
            const isExternal =
              href && (href.startsWith("http://") || href.startsWith("https://"));
            return (
              <a
                href={href}
                {...(isExternal
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                {...props}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;
