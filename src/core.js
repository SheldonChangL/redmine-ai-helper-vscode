'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const vscode = require('vscode');

const HOME = os.homedir();
const LAST_ISSUE_ID_KEY = 'redmineAiHelper.lastIssueId';
const LAST_PROJECT_ID_KEY = 'redmineAiHelper.lastProjectId';
const REDMINE_BASE_URL_KEY = 'redmineAiHelper.redmineBaseUrl';
const REDMINE_ACCESS_TOKEN_KEY = 'redmineAiHelper.redmineAccessToken';
const AUTO_APPLY_TRUST_KEY = 'redmineAiHelper.autoApplyTrusted';

const BACKEND_LABELS = {
  codex: 'Codex CLI',
  claude: 'Claude CLI',
  ollama: 'Ollama',
};

const PROBE_PATHS = {
  ollama: ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama'],
  claude: [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    path.join(HOME, '.local', 'bin', 'claude'),
    path.join(HOME, 'bin', 'claude'),
    path.join(HOME, '.volta', 'bin', 'claude'),
  ],
  codex: [
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
    path.join(HOME, '.local', 'bin', 'codex'),
    path.join(HOME, 'bin', 'codex'),
    path.join(HOME, '.volta', 'bin', 'codex'),
  ],
};

function getConfig() {
  return vscode.workspace.getConfiguration('redmineAiHelper');
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function buildEnv() {
  const pathEntries = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(HOME, '.local', 'bin'),
    path.join(HOME, 'bin'),
    path.join(HOME, '.volta', 'bin'),
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean),
  ];

  return {
    ...process.env,
    PATH: [...new Set(pathEntries)].join(path.delimiter),
  };
}

function findBinaryOnPath(binary, envPath) {
  for (const dir of envPath.split(path.delimiter)) {
    const candidate = path.join(dir, binary);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function findBinaryInNvm(binary) {
  const versionsDir = path.join(HOME, '.nvm', 'versions', 'node');
  try {
    const versions = fs.readdirSync(versionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();

    for (const version of versions) {
      const candidate = path.join(versionsDir, version, 'bin', binary);
      if (isExecutable(candidate)) return candidate;
    }
  } catch {
    // ignore
  }
  return null;
}

function findBinary(backend, env) {
  for (const probe of (PROBE_PATHS[backend] || [])) {
    if (isExecutable(probe)) return probe;
  }
  const pathHit = findBinaryOnPath(backend, env.PATH || '');
  if (pathHit) return pathHit;
  const nvmHit = findBinaryInNvm(backend);
  if (nvmHit) return nvmHit;
  return backend;
}

async function getStoredConnection(context) {
  const config = getConfig();
  return {
    baseUrl: String(
      context.globalState.get(REDMINE_BASE_URL_KEY)
      || config.get('redmineBaseUrl')
      || '',
    ).trim(),
    accessToken: String(
      await context.secrets.get(REDMINE_ACCESS_TOKEN_KEY)
      || config.get('redmineApiKey')
      || '',
    ).trim(),
  };
}

async function saveConnection(context, { baseUrl, accessToken }) {
  await context.globalState.update(REDMINE_BASE_URL_KEY, String(baseUrl || '').trim());
  await context.secrets.store(REDMINE_ACCESS_TOKEN_KEY, String(accessToken || '').trim());
}

async function getSidebarDefaults(context) {
  const connection = await getStoredConnection(context);
  const config = getConfig();
  return {
    baseUrl: connection.baseUrl,
    accessToken: connection.accessToken,
    backend: String(config.get('aiBackend') || 'codex'),
    codexModel: String(config.get('codexModel') || ''),
    ollamaModel: String(config.get('ollamaModel') || 'llama3.2'),
    scope: 'activeFile',
    autoApplyTrusted: Boolean(context.globalState.get(AUTO_APPLY_TRUST_KEY) || false),
    selectedProjectId: String(context.workspaceState.get(LAST_PROJECT_ID_KEY) || ''),
    selectedIssueId: String(context.workspaceState.get(LAST_ISSUE_ID_KEY) || ''),
  };
}

async function resolveConnection(context, overrides = {}) {
  const stored = await getStoredConnection(context);
  const baseUrl = String(overrides.baseUrl ?? stored.baseUrl ?? '').trim().replace(/\/$/, '');
  const accessToken = String(overrides.accessToken ?? stored.accessToken ?? '').trim();

  if (!baseUrl || !accessToken) {
    throw new Error('Enter your Redmine base URL and access token first.');
  }

  return { baseUrl, accessToken };
}

async function redmineGet(context, apiPath, overrides = {}) {
  const connection = await resolveConnection(context, overrides);
  const response = await fetch(`${connection.baseUrl}${apiPath}`, {
    headers: {
      'X-Redmine-API-Key': connection.accessToken,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Redmine request failed (${response.status}): ${text || response.statusText}`);
  }

  return response.json();
}

async function fetchProjects(context, overrides = {}) {
  const json = await redmineGet(context, '/projects.json?limit=100', overrides);
  return (json.projects || []).map((project) => ({
    id: String(project.id),
    name: project.name,
    identifier: project.identifier,
  }));
}

async function fetchMyIssues(context, projectId, overrides = {}) {
  if (!projectId) return [];
  const json = await redmineGet(
    context,
    `/issues.json?project_id=${encodeURIComponent(projectId)}&assigned_to_id=me&status_id=open&limit=100`,
    overrides,
  );
  return (json.issues || []).map((issue) => ({
    id: String(issue.id),
    subject: issue.subject,
    tracker: issue.tracker?.name || '',
    status: issue.status?.name || '',
    updatedOn: issue.updated_on || '',
  }));
}

async function fetchIssue(context, issueId, overrides = {}) {
  const json = await redmineGet(
    context,
    `/issues/${issueId}.json?include=children,attachments,journals,watchers`,
    overrides,
  );
  return json.issue;
}

function formatIssue(issue) {
  return [
    `#${issue.id} - ${issue.subject}`,
    `Status: ${issue.status?.name || 'Unknown'}`,
    `Priority: ${issue.priority?.name || 'Unknown'}`,
    `Assignee: ${issue.assigned_to?.name || 'Unassigned'}`,
    '',
    issue.description || '(no description)',
  ].join('\n');
}

async function promptForIssueId(context, initialValue) {
  const remembered = context.workspaceState.get(LAST_ISSUE_ID_KEY);
  const value = await vscode.window.showInputBox({
    title: 'Redmine Issue ID',
    prompt: 'Enter the Redmine issue ID to analyze',
    ignoreFocusOut: true,
    value: String(initialValue || remembered || ''),
    validateInput: (input) => /^\d+$/.test(input.trim()) ? null : 'Enter a numeric issue ID.',
  });

  if (!value) {
    throw new Error('Issue ID input was cancelled.');
  }

  const issueId = Number(value.trim());
  await context.workspaceState.update(LAST_ISSUE_ID_KEY, issueId);
  return issueId;
}

function ensureWorkspaceFolderForUri(uri) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (workspaceFolder) return workspaceFolder;
  throw new Error('The selected file or folder must be inside an open workspace.');
}

async function chooseWorkspaceFolder() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) {
    throw new Error('Open a folder or workspace in VS Code first.');
  }
  if (folders.length === 1) return folders[0];

  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
    })),
    { placeHolder: 'Choose the workspace folder to analyze' },
  );

  if (!picked) {
    throw new Error('Workspace folder selection was cancelled.');
  }

  return picked.folder;
}

function resolveActiveEditorUri() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.document || editor.document.isUntitled) {
    throw new Error('Open a file in the editor first.');
  }
  return editor.document.uri;
}

async function resolveTarget(scope, resourceUri) {
  if (scope === 'activeFile') {
    const uri = resolveActiveEditorUri();
    return {
      kind: 'file',
      uri,
      workspaceFolder: ensureWorkspaceFolderForUri(uri),
      rootPath: uri.fsPath,
      label: `Active file: ${path.basename(uri.fsPath)}`,
    };
  }

  if (scope === 'activeFolder') {
    const uri = resolveActiveEditorUri();
    const folderPath = path.dirname(uri.fsPath);
    const folderUri = vscode.Uri.file(folderPath);
    return {
      kind: 'directory',
      uri: folderUri,
      workspaceFolder: ensureWorkspaceFolderForUri(uri),
      rootPath: folderPath,
      label: `Active folder: ${path.basename(folderPath)}`,
    };
  }

  if (scope === 'resource') {
    if (!resourceUri) throw new Error('No file or folder was selected.');

    const stat = await vscode.workspace.fs.stat(resourceUri);
    const workspaceFolder = ensureWorkspaceFolderForUri(resourceUri);
    return {
      kind: stat.type === vscode.FileType.Directory ? 'directory' : 'file',
      uri: resourceUri,
      workspaceFolder,
      rootPath: resourceUri.fsPath,
      label: `${stat.type === vscode.FileType.Directory ? 'Folder' : 'File'}: ${path.relative(workspaceFolder.uri.fsPath, resourceUri.fsPath)}`,
    };
  }

  const workspaceFolder = await chooseWorkspaceFolder();
  return {
    kind: 'directory',
    uri: workspaceFolder.uri,
    workspaceFolder,
    rootPath: workspaceFolder.uri.fsPath,
    label: `Workspace: ${workspaceFolder.name}`,
  };
}

function shouldIncludeFile(filePath, includeExtensions, maxFileBytes) {
  const ext = path.extname(filePath).toLowerCase();
  if (!includeExtensions.has(ext)) return false;

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }

  return stat.isFile() && stat.size <= maxFileBytes;
}

function collectCodeContext(target, options) {
  const files = [];
  const totalBytes = { value: 0 };

  function addFile(filePath) {
    if (totalBytes.value >= options.maxTotalBytes) return;
    if (!shouldIncludeFile(filePath, options.includeExtensions, options.maxFileBytes)) return;

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return;
    }

    totalBytes.value += content.length;
    files.push({
      path: path.relative(target.workspaceFolder.uri.fsPath, filePath),
      content,
    });
  }

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (totalBytes.value >= options.maxTotalBytes) return;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!options.excludeDirectories.has(entry.name)) {
          walk(fullPath);
        }
        continue;
      }

      if (entry.isFile()) addFile(fullPath);
    }
  }

  if (target.kind === 'file') {
    addFile(target.rootPath);
  } else {
    walk(target.rootPath);
  }

  return {
    files,
    truncated: totalBytes.value >= options.maxTotalBytes,
  };
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

function runBackend(prompt, backend, models, env) {
  const bin = findBinary(backend, env);
  let args;
  let stdin;

  if (backend === 'codex') {
    args = ['exec', '--full-auto', '--skip-git-repo-check'];
    if (models.codexModel) args.push('-m', models.codexModel);
    args.push(prompt);
  } else if (backend === 'claude') {
    args = ['-p'];
    stdin = prompt;
  } else if (backend === 'ollama') {
    args = ['run', models.ollamaModel || 'llama3.2', '--nowordwrap'];
    stdin = prompt;
  } else {
    return Promise.reject(new Error(`Unsupported backend: ${backend}`));
  }

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const proc = spawn(bin, args, {
      env,
      stdio: stdin === undefined ? ['ignore', 'pipe', 'pipe'] : 'pipe',
    });

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `${BACKEND_LABELS[backend]} exited with code ${code}.`));
    });

    if (stdin !== undefined) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }
  });
}

function runGitApply(workspacePath, patchText, env, checkOnly) {
  const tempPath = path.join(os.tmpdir(), `redmine-ai-helper-${Date.now()}.patch`);
  fs.writeFileSync(tempPath, sanitizePatchText(patchText), 'utf-8');

  return new Promise((resolve) => {
    let stderr = '';
    const args = ['apply'];
    if (checkOnly) args.push('--check');
    args.push(tempPath);

    const proc = spawn('git', args, {
      cwd: workspacePath,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (error) => {
      try { fs.unlinkSync(tempPath); } catch {}
      resolve({ ok: false, error: error.message });
    });

    proc.on('close', (code) => {
      try { fs.unlinkSync(tempPath); } catch {}
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: stderr.trim() || `git apply ${checkOnly ? '--check ' : ''}exited with code ${code}.` });
      }
    });
  });
}

function checkPatchApplicability(workspacePath, patchText, env) {
  return runGitApply(workspacePath, patchText, env, true);
}

function applyPatchToWorkspace(workspacePath, patchText, env) {
  return runGitApply(workspacePath, patchText, env, false);
}

async function showOutputDocument(content, language) {
  const doc = await vscode.workspace.openTextDocument({ content, language });
  await vscode.window.showTextDocument(doc, { preview: false });
  return doc;
}

function createStatusReporter(outputChannel, externalReporter) {
  return (message) => {
    outputChannel.appendLine(message);
    if (externalReporter) externalReporter(message);
  };
}

async function maybeConfirmAndApplyPatch(target, issueId, patchText, autoApplyTrusted, env, report) {
  const normalizedPatch = sanitizePatchText(patchText);

  if (autoApplyTrusted) {
    report('Trusted mode enabled. Applying patch directly…');
    const applied = await applyPatchToWorkspace(target.workspaceFolder.uri.fsPath, normalizedPatch, env);
    if (!applied.ok) {
      throw new Error(`Failed to apply patch: ${applied.error}`);
    }
    return { applied: true, previewed: false };
  }

  await showOutputDocument(normalizedPatch, 'diff');
  const choice = await vscode.window.showInformationMessage(
    `Apply generated patch for Redmine #${issueId} to ${target.workspaceFolder.name}?`,
    { modal: true },
    'Apply',
    'Cancel',
  );

  if (choice !== 'Apply') {
    report('Patch preview opened. Changes were not applied.');
    return { applied: false, previewed: true };
  }

  report('Applying approved patch to workspace…');
  const applied = await applyPatchToWorkspace(target.workspaceFolder.uri.fsPath, normalizedPatch, env);
  if (!applied.ok) {
    throw new Error(`Failed to apply patch: ${applied.error}`);
  }

  return { applied: true, previewed: true };
}

async function runTask(context, outputChannel, options) {
  const config = getConfig();
  const report = createStatusReporter(outputChannel, options.onStatus);
  const backend = String(options.backend || config.get('aiBackend') || 'codex');
  const models = {
    codexModel: String(options.codexModel ?? config.get('codexModel') ?? '').trim(),
    ollamaModel: String(options.ollamaModel ?? config.get('ollamaModel') ?? 'llama3.2').trim(),
  };
  const includeExtensions = new Set((config.get('includeExtensions') || []).map((ext) => String(ext).toLowerCase()));
  const excludeDirectories = new Set((config.get('excludeDirectories') || []).map((name) => String(name)));
  const maxFileBytes = Number(config.get('maxFileBytes') || 51200);
  const maxTotalBytes = Number(config.get('maxTotalBytes') || 204800);
  const env = buildEnv();
  const issueId = Number(options.issueId || await promptForIssueId(context, options.defaultIssueId));
  const autoApplyTrusted = Boolean(options.autoApplyTrusted ?? context.globalState.get(AUTO_APPLY_TRUST_KEY) ?? false);

  if (!issueId) {
    throw new Error('Choose a Redmine issue first.');
  }

  await context.workspaceState.update(LAST_ISSUE_ID_KEY, issueId);
  if (options.projectId) {
    await context.workspaceState.update(LAST_PROJECT_ID_KEY, String(options.projectId));
  }
  if (typeof options.autoApplyTrusted === 'boolean') {
    await context.globalState.update(AUTO_APPLY_TRUST_KEY, options.autoApplyTrusted);
  }

  outputChannel.show(true);

  const title = options.action === 'patch'
    ? `Preparing code changes for Redmine #${issueId}`
    : `Analyzing Redmine #${issueId}`;

  return vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title,
    cancellable: false,
  }, async (progress) => {
    const update = (message) => {
      progress.report({ message });
      report(message);
    };

    update('Resolving analysis target…');
    const target = await resolveTarget(options.scope || 'activeFile', options.resourceUri);

    update('Fetching issue from Redmine…');
    const issue = await fetchIssue(context, issueId, {
      baseUrl: options.baseUrl,
      accessToken: options.accessToken,
    });

    update(`Scanning ${target.label}…`);
    const contextData = collectCodeContext(target, {
      includeExtensions,
      excludeDirectories,
      maxFileBytes,
      maxTotalBytes,
    });

    if (contextData.files.length === 0) {
      throw new Error('No supported code files were found in the selected scope.');
    }

    const issueText = formatIssue(issue);
    const codeText = formatCodeFiles(contextData.files);
    const prompt = options.action === 'patch'
      ? buildPatchPrompt(issueText, codeText, contextData.truncated)
      : buildAnalysisPrompt(issueText, codeText, contextData.truncated);

    update(`Running ${BACKEND_LABELS[backend] || backend}…`);
    const output = await runBackend(prompt, backend, models, env);

    if (options.action === 'patch') {
      if (!looksLikePatch(output)) {
        await showOutputDocument(output, 'diff');
        throw new Error('AI output did not look like a valid patch. The raw output has been opened for inspection.');
      }

      update('Validating generated patch…');
      const check = await checkPatchApplicability(target.workspaceFolder.uri.fsPath, output, env);
      if (!check.ok) {
        await showOutputDocument(sanitizePatchText(output), 'diff');
        throw new Error(`Patch validation failed: ${check.error}`);
      }

      const result = await maybeConfirmAndApplyPatch(target, issueId, output, autoApplyTrusted, env, report);
      const success = result.applied
        ? `Patch applied for Redmine #${issueId}.`
        : `Patch generated for Redmine #${issueId}, but not applied.`;
      report(success);
      vscode.window.showInformationMessage(success);
      return { issueId, target, output, ...result };
    }

    await showOutputDocument(output, 'markdown');
    report(`Analysis opened for issue #${issueId}.`);
    return { issueId, target, output, applied: false };
  });
}

module.exports = {
  AUTO_APPLY_TRUST_KEY,
  BACKEND_LABELS,
  LAST_ISSUE_ID_KEY,
  LAST_PROJECT_ID_KEY,
  getConfig,
  getSidebarDefaults,
  saveConnection,
  fetchProjects,
  fetchMyIssues,
  runTask,
};
