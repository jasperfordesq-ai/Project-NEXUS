// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { execFileSync } = require('child_process');
const path = require('path');

function runGit(checkoutPath, args) {
  try {
    return execFileSync('git', ['-C', checkoutPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    const detail = String(error.stderr || error.message || '').trim();
    throw new Error(`Unable to read Git provenance for ${checkoutPath}: ${detail || 'git command failed'}`);
  }
}

function inspectGitCheckout(checkoutPath) {
  const repositoryRoot = runGit(checkoutPath, ['rev-parse', '--show-toplevel']);
  const commitSha = runGit(repositoryRoot, ['rev-parse', 'HEAD']);
  const workingTreeDirty = runGit(repositoryRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=normal'
  ]) !== '';

  return {
    repositoryRoot: path.resolve(repositoryRoot),
    commitSha,
    workingTreeDirty
  };
}

function provenanceCaveat(laravel, webUkRepository) {
  const dirtyCheckouts = [];
  if (laravel.workingTreeDirty) dirtyCheckouts.push('Laravel');
  if (webUkRepository.workingTreeDirty) dirtyCheckouts.push('Web UK repository');

  if (!dirtyCheckouts.length) {
    return 'Both working trees were clean when generated; the commit SHAs identify the exact checked-out inputs.';
  }

  return `${dirtyCheckouts.join(' and ')} working tree${dirtyCheckouts.length === 1 ? ' was' : 's were'} dirty when generated. Commit SHAs identify HEAD only; generated content may include uncommitted changes from the dirty working tree${dirtyCheckouts.length === 1 ? '' : 's'}.`;
}

function collectGeneratorProvenance({ laravelRoot, webUkRoot, generatedAt = new Date().toISOString() }) {
  const laravel = inspectGitCheckout(laravelRoot);
  const webUkRepository = inspectGitCheckout(webUkRoot);
  const webUkPath = path.relative(webUkRepository.repositoryRoot, path.resolve(webUkRoot)).replace(/\\/g, '/') || '.';

  return {
    generatedAt,
    laravelRepositoryRoot: laravel.repositoryRoot,
    laravelCommitSha: laravel.commitSha,
    laravelWorkingTreeDirty: laravel.workingTreeDirty,
    webUkRepositoryRoot: webUkRepository.repositoryRoot,
    webUkPath,
    webUkRepositoryCommitSha: webUkRepository.commitSha,
    webUkRepositoryWorkingTreeDirty: webUkRepository.workingTreeDirty,
    caveat: provenanceCaveat(laravel, webUkRepository)
  };
}

module.exports = {
  collectGeneratorProvenance,
  inspectGitCheckout,
  provenanceCaveat
};
