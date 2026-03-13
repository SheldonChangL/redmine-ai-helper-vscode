'use strict';

// Pure utility functions — no vscode dependency allowed in this file.

function sanitizePatchText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';

  const fenced = trimmed.match(/^```(?:diff|patch)?\s*\n([\s\S]*?)\n```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function looksLikePatch(text) {
  const normalized = sanitizePatchText(text);
  return /(^diff --git\s)|(^---\s)|(^\+\+\+\s)|(^@@\s)/m.test(normalized);
}

function formatCodeFiles(files) {
  return files.map((file) => `=== ${file.path} ===\n${file.content}`).join('\n\n');
}

function buildAnalysisPrompt(issueText, codeText, truncated) {
  const truncationNote = truncated ? '\n\nNote: code context was truncated to fit the prompt budget.' : '';
  return [
    'You are a senior software engineer.',
    'Given the issue below and the relevant source files, analyze the root cause and suggest specific code changes to resolve the issue.',
    'Reference file names where possible.',
    '',
    'Issue:',
    issueText,
    '',
    'Source files:',
    codeText,
    truncationNote,
  ].join('\n');
}

function buildPatchPrompt(issueText, codeText, truncated) {
  const truncationNote = truncated
    ? 'The code context was truncated, so avoid editing files that are not shown.'
    : 'Use only the provided files when deciding what to change.';

  return [
    'You are a senior software engineer.',
    'Given the issue below and the relevant source files, produce a unified diff patch that fixes the issue.',
    'Requirements:',
    '- Output only the patch content.',
    '- Do not wrap the patch in markdown fences.',
    '- Use standard unified diff format with --- and +++ headers.',
    '- Include complete hunks with context lines.',
    '- Make paths relative to the workspace root.',
    `- ${truncationNote}`,
    '',
    'Issue:',
    issueText,
    '',
    'Source files:',
    codeText,
  ].join('\n');
}

/**
 * Extract the list of changed file paths from a unified diff patch.
 * @param {string} patchText
 * @returns {string[]} deduplicated list of file paths
 */
function parseChangedFiles(patchText) {
  const files = [];
  for (const line of sanitizePatchText(patchText).split('\n')) {
    if (line.startsWith('+++ ')) {
      const match = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
      if (match && match[1].trim() !== '/dev/null') files.push(match[1].trim());
    }
  }
  return [...new Set(files)];
}

/**
 * Parse a unified diff into individual hunk objects.
 * Each hunk object: { filePath, fileHeader, lines }
 * fileHeader includes the "--- ..." and "+++ ..." lines.
 * lines includes the "@@ ..." line and all content lines until next hunk/file.
 *
 * @param {string} patchText
 * @returns {Array<{filePath: string, fileHeader: string, lines: string[]}>}
 */
function parseHunks(patchText) {
  const normalized = sanitizePatchText(patchText);
  const allLines = normalized.split('\n');
  const hunks = [];

  let currentFileHeader = '';
  let currentFilePath = '';
  let currentHunkLines = null;
  let i = 0;

  while (i < allLines.length) {
    const line = allLines[i];

    // Detect start of a new file: "--- " line followed by "+++ " line
    if (line.startsWith('--- ') && i + 1 < allLines.length && allLines[i + 1].startsWith('+++ ')) {
      // Save any pending hunk before moving to new file
      if (currentHunkLines !== null && currentHunkLines.length > 0) {
        hunks.push({
          filePath: currentFilePath,
          fileHeader: currentFileHeader,
          lines: currentHunkLines,
        });
        currentHunkLines = null;
      }

      const plusLine = allLines[i + 1];
      const filePathMatch = plusLine.match(/^\+\+\+ (?:b\/)?(.+)$/);
      currentFilePath = filePathMatch ? filePathMatch[1].trim() : plusLine.slice(4).trim();
      currentFileHeader = line + '\n' + plusLine;
      i += 2;
      continue;
    }

    // Detect "diff --git" header lines (git-style patches)
    if (line.startsWith('diff --git ')) {
      // Save any pending hunk
      if (currentHunkLines !== null && currentHunkLines.length > 0) {
        hunks.push({
          filePath: currentFilePath,
          fileHeader: currentFileHeader,
          lines: currentHunkLines,
        });
        currentHunkLines = null;
      }
      // Accumulate lines until we hit --- / +++ pair
      // For now just skip this line; the --- / +++ detection above will capture the file header
      i++;
      continue;
    }

    // Detect hunk header: "@@ ... @@"
    if (line.startsWith('@@ ')) {
      // Save any pending hunk
      if (currentHunkLines !== null && currentHunkLines.length > 0) {
        hunks.push({
          filePath: currentFilePath,
          fileHeader: currentFileHeader,
          lines: currentHunkLines,
        });
      }
      currentHunkLines = [line];
      i++;
      continue;
    }

    // Content lines (context, add, remove) — append to current hunk
    if (currentHunkLines !== null) {
      currentHunkLines.push(line);
    }

    i++;
  }

  // Flush last hunk
  if (currentHunkLines !== null && currentHunkLines.length > 0) {
    hunks.push({
      filePath: currentFilePath,
      fileHeader: currentFileHeader,
      lines: currentHunkLines,
    });
  }

  return hunks;
}

/**
 * Reconstruct a patch text from an array of hunk objects (as returned by parseHunks).
 * Groups hunks by fileHeader, emitting the header once per file.
 *
 * @param {Array<{filePath: string, fileHeader: string, lines: string[]}>} hunks
 * @returns {string}
 */
function reconstructPatch(hunks) {
  if (hunks.length === 0) return '';

  const groups = [];
  const seen = new Map(); // fileHeader -> index in groups

  for (const hunk of hunks) {
    if (!seen.has(hunk.fileHeader)) {
      seen.set(hunk.fileHeader, groups.length);
      groups.push({ fileHeader: hunk.fileHeader, hunkLines: [] });
    }
    const idx = seen.get(hunk.fileHeader);
    groups[idx].hunkLines.push(hunk.lines.join('\n'));
  }

  return groups
    .map((g) => g.fileHeader + '\n' + g.hunkLines.join('\n'))
    .join('\n');
}

module.exports = {
  sanitizePatchText,
  looksLikePatch,
  formatCodeFiles,
  buildAnalysisPrompt,
  buildPatchPrompt,
  parseChangedFiles,
  parseHunks,
  reconstructPatch,
};
