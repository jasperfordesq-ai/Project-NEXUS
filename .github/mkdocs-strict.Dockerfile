# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
# Throwaway MkDocs runner, pinned to EXACTLY the versions .github/workflows/docs-lint.yml
# installs, so a local pass means the same thing CI's docs-build job means.
#
# Deliberately a container rather than a host install: this machine has no Python,
# and adding one system-wide to run a documentation linter is a bigger change than
# the job needs.
FROM python:3.12-alpine

RUN pip install --no-cache-dir \
      "mkdocs==1.6.1" \
      "mkdocs-material==9.7.6" \
      "pymdown-extensions==11.0.1"

WORKDIR /repo
ENTRYPOINT ["mkdocs"]
