'use strict';

const vscode = require('vscode');
const {
  BACKEND_LABELS,
  LAST_PROJECT_ID_KEY,
  getConfig,
  getSidebarDefaults,
  saveConnection,
  fetchProjects,
  fetchMyIssues,
  fetchIssue,
} = require('./core');

class SidebarProvider {
  constructor(context, handlers) {
    this.context = context;
    this.handlers = handlers;
    this.view = null;
    this.state = {
      busy: false,
      status: 'Ready.',
      baseUrl: '',
      accessToken: '',
      backend: String(getConfig().get('aiBackend') || 'codex'),
      codexModel: String(getConfig().get('codexModel') || ''),
      ollamaModel: String(getConfig().get('ollamaModel') || 'llama3.2'),
      scope: 'activeFile',
      autoApplyTrusted: false,
      selectedProjectId: '',
      selectedIssueId: '',
      projects: [],
      issues: [],
      selectedIssue: null,
    };
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'saveConnection') {
        await this.handleSaveConnection(message.payload, true);
        return;
      }
      if (message.type === 'loadProjects') {
        await this.handleLoadProjects(message.payload);
        return;
      }
      if (message.type === 'loadIssues') {
        await this.handleLoadIssues(message.payload);
        return;
      }
      if (message.type === 'selectIssue') {
        await this.handleSelectIssue(message.payload);
        return;
      }
      if (message.type === 'run') {
        await this.handleRun(message.payload);
        return;
      }
      if (message.type === 'openSettings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:local.redmine-ai-helper-vscode redmineAiHelper');
      }
    });

    void this.bootstrap();
  }

  async bootstrap() {
    try {
      const defaults = await getSidebarDefaults(this.context);
      this.updateState(defaults);

      if (defaults.baseUrl && defaults.accessToken) {
        await this.handleLoadProjects(defaults, true);
        if (defaults.selectedProjectId) {
          await this.handleLoadIssues({
            ...defaults,
            projectId: defaults.selectedProjectId,
            selectedIssueId: defaults.selectedIssueId,
          }, true);
        }
      } else {
        this.updateState({ status: 'Enter your Redmine URL and access token, then load projects.' });
      }
    } catch (error) {
      this.updateState({ status: error.message });
    }
  }

  updateState(patch) {
    this.state = { ...this.state, ...patch };
    this.postState();
  }

  postState() {
    if (this.view) {
      this.view.webview.postMessage({
        type: 'state',
        payload: {
          ...this.state,
          backendLabels: BACKEND_LABELS,
        },
      });
    }
  }

  async persistConnection(payload) {
    const baseUrl = String(payload.baseUrl || '').trim();
    const accessToken = String(payload.accessToken || '').trim();
    await saveConnection(this.context, { baseUrl, accessToken });
    this.updateState({ baseUrl, accessToken });
    return { baseUrl, accessToken };
  }

  async handleSaveConnection(payload, updateStatus) {
    try {
      this.updateState({ busy: true, status: 'Saving Redmine connection…' });
      const connection = await this.persistConnection(payload);
      this.updateState({
        busy: false,
        status: updateStatus ? 'Connection saved.' : this.state.status,
        ...connection,
      });
    } catch (error) {
      this.updateState({ busy: false, status: error.message });
      vscode.window.showErrorMessage(error.message);
    }
  }

  async handleLoadProjects(payload, silent = false) {
    try {
      const previousStatus = this.state.status;
      this.updateState({ busy: true, status: 'Loading projects…' });
      const connection = await this.persistConnection(payload);
      const projects = await fetchProjects(this.context, connection);
      const selectedProjectId = String(payload.selectedProjectId || this.state.selectedProjectId || projects[0]?.id || '');

      this.updateState({
        busy: false,
        status: silent ? previousStatus : `Loaded ${projects.length} project(s).`,
        projects,
        selectedProjectId,
        selectedIssueId: '',
        issues: [],
      });
    } catch (error) {
      this.updateState({ busy: false, status: error.message, projects: [], issues: [] });
      if (!silent) vscode.window.showErrorMessage(error.message);
    }
  }

  async handleLoadIssues(payload, silent = false) {
    try {
      const projectId = String(payload.projectId || this.state.selectedProjectId || '').trim();
      if (!projectId) {
        throw new Error('Choose a Redmine project first.');
      }

      const previousStatus = this.state.status;
      this.updateState({
        busy: true,
        status: 'Loading issues assigned to me…',
        selectedProjectId: projectId,
      });
      const connection = await this.persistConnection(payload);
      const issues = await fetchMyIssues(this.context, projectId, connection);
      const selectedIssueId = String(payload.selectedIssueId || this.state.selectedIssueId || issues[0]?.id || '');

      await this.context.workspaceState.update(LAST_PROJECT_ID_KEY, projectId);
      this.updateState({
        busy: false,
        status: silent ? previousStatus : `Loaded ${issues.length} open issue(s) assigned to you.`,
        issues,
        selectedProjectId: projectId,
        selectedIssueId,
        selectedIssue: null,
      });
    } catch (error) {
      this.updateState({ busy: false, status: error.message, issues: [] });
      if (!silent) vscode.window.showErrorMessage(error.message);
    }
  }

  async handleSelectIssue(payload) {
    const issueId = String(payload.selectedIssueId || '').trim();
    this.updateState({ selectedIssueId: issueId, selectedIssue: null });
    if (!issueId) return;
    try {
      const connection = await this.persistConnection(payload);
      const issue = await fetchIssue(this.context, issueId, connection);
      this.updateState({ selectedIssue: issue });
    } catch {
      // issue detail is non-critical; silently skip
    }
  }

  async handleRun(payload) {
    try {
      const projectId = String(payload.selectedProjectId || '').trim();
      const issueId = Number(payload.selectedIssueId || payload.issueId || 0);

      if (!issueId) {
        throw new Error('Choose a Redmine issue first.');
      }

      this.updateState({
        busy: true,
        status: payload.action === 'patch' ? 'Preparing code changes…' : 'Starting analysis…',
        baseUrl: String(payload.baseUrl || '').trim(),
        accessToken: String(payload.accessToken || '').trim(),
        backend: payload.backend,
        codexModel: payload.codexModel,
        ollamaModel: payload.ollamaModel,
        scope: payload.scope,
        autoApplyTrusted: Boolean(payload.autoApplyTrusted),
        selectedProjectId: projectId,
        selectedIssueId: String(issueId),
      });

      await this.persistConnection(payload);
      if (projectId) {
        await this.context.workspaceState.update(LAST_PROJECT_ID_KEY, projectId);
      }

      await this.handlers.runFromPanel({
        action: payload.action,
        issueId,
        projectId,
        baseUrl: payload.baseUrl,
        accessToken: payload.accessToken,
        backend: payload.backend,
        codexModel: payload.codexModel,
        ollamaModel: payload.ollamaModel,
        scope: payload.scope,
        autoApplyTrusted: Boolean(payload.autoApplyTrusted),
        onStatus: (status) => this.updateState({ status }),
      });

      this.updateState({
        busy: false,
        status: payload.action === 'patch'
          ? (payload.autoApplyTrusted ? 'Code changed and applied.' : 'Patch generated. Review/apply prompt completed.')
          : 'Analysis completed.',
      });
    } catch (error) {
      this.updateState({ busy: false, status: error.message });
      vscode.window.showErrorMessage(error.message);
    }
  }

  getHtml() {
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .block {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    label {
      font-size: 12px;
      font-weight: 600;
    }
    input, select, button {
      font: inherit;
    }
    input, select {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid var(--vscode-input-border, transparent);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
    }
    button {
      border: none;
      border-radius: 6px;
      padding: 8px 10px;
      cursor: pointer;
    }
    .row {
      display: flex;
      gap: 8px;
    }
    .row > * {
      flex: 1;
    }
    .actions {
      display: flex;
      gap: 8px;
    }
    .primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .secondary {
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    }
    .status {
      white-space: pre-wrap;
      padding: 8px 10px;
      border-radius: 6px;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-widget-border, transparent);
      min-height: 68px;
      font-size: 12px;
      line-height: 1.4;
    }
    .hint {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
    }
    .checkbox {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
    }
    .checkbox input {
      width: auto;
    }
    .issue-detail {
      display: none;
      flex-direction: column;
      gap: 6px;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-widget-border, transparent);
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 12px;
      line-height: 1.5;
    }
    .issue-detail.visible {
      display: flex;
    }
    .issue-detail-description {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .issue-detail-meta {
      color: var(--vscode-descriptionForeground);
    }
    .issue-journals {
      display: flex;
      flex-direction: column;
      gap: 6px;
      border-top: 1px solid var(--vscode-widget-border, transparent);
      padding-top: 6px;
      margin-top: 2px;
    }
    .journal-entry {
      background: var(--vscode-input-background);
      border-radius: 4px;
      padding: 6px 8px;
    }
    .journal-meta {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    .journal-notes {
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="block">
    <label for="baseUrl">Redmine Base URL</label>
    <input id="baseUrl" type="text" placeholder="https://redmine.example.com" />
  </div>

  <div class="block">
    <label for="accessToken">Redmine Access Token</label>
    <input id="accessToken" type="password" placeholder="Paste your Redmine access token" />
  </div>

  <div class="actions">
    <button id="saveConnection" class="secondary">Save Connection</button>
    <button id="loadProjects" class="secondary">Load Projects</button>
  </div>

  <div class="block">
    <label for="project">Project</label>
    <select id="project">
      <option value="">Select a project</option>
    </select>
  </div>

  <div class="actions">
    <button id="loadIssues" class="secondary">Load My Issues</button>
  </div>

  <div class="block">
    <label for="issue">My Open Issues</label>
    <select id="issue">
      <option value="">Select an issue</option>
    </select>
  </div>

  <div id="issueDetail" class="issue-detail">
    <div id="issueDetailMeta" class="issue-detail-meta"></div>
    <div id="issueDetailDescription" class="issue-detail-description"></div>
    <div id="issueJournals" class="issue-journals" style="display:none"></div>
  </div>

  <div class="block">
    <label for="scope">Analysis Scope</label>
    <select id="scope">
      <option value="activeFile">Current File</option>
      <option value="activeFolder">Current File Folder</option>
      <option value="workspace">Workspace</option>
    </select>
    <div class="hint">Project view context actions still work for a specific file or folder.</div>
  </div>

  <div class="row">
    <div class="block">
      <label for="backend">Backend</label>
      <select id="backend">
        <option value="codex">Codex CLI</option>
        <option value="claude">Claude CLI</option>
        <option value="ollama">Ollama</option>
      </select>
    </div>
    <div class="block" id="codexModelBlock">
      <label for="codexModel">Codex Model</label>
      <input id="codexModel" type="text" placeholder="optional" />
    </div>
  </div>

  <div class="block" id="ollamaModelBlock">
    <label for="ollamaModel">Ollama Model</label>
    <input id="ollamaModel" type="text" placeholder="llama3.2" />
  </div>

  <label class="checkbox">
    <input id="autoApplyTrusted" type="checkbox" />
    <span>Trust AI and auto-apply validated code changes</span>
  </label>

  <div class="actions">
    <button id="analyze" class="secondary">Analyze Only</button>
    <button id="changeCode" class="primary">Analyze + Change Code</button>
  </div>

  <button id="settings" class="secondary">Open Extension Settings</button>

  <div class="block">
    <label>Status</label>
    <div id="status" class="status">Ready.</div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const state = {
      busy: false,
      status: 'Ready.',
      baseUrl: '',
      accessToken: '',
      backend: 'codex',
      codexModel: '',
      ollamaModel: 'llama3.2',
      scope: 'activeFile',
      autoApplyTrusted: false,
      selectedProjectId: '',
      selectedIssueId: '',
      projects: [],
      issues: [],
      selectedIssue: null
    };

    const baseUrlEl = document.getElementById('baseUrl');
    const accessTokenEl = document.getElementById('accessToken');
    const projectEl = document.getElementById('project');
    const issueEl = document.getElementById('issue');
    const scopeEl = document.getElementById('scope');
    const backendEl = document.getElementById('backend');
    const codexModelEl = document.getElementById('codexModel');
    const codexModelBlockEl = document.getElementById('codexModelBlock');
    const ollamaModelEl = document.getElementById('ollamaModel');
    const ollamaModelBlockEl = document.getElementById('ollamaModelBlock');
    const autoApplyTrustedEl = document.getElementById('autoApplyTrusted');
    const analyzeEl = document.getElementById('analyze');
    const changeCodeEl = document.getElementById('changeCode');
    const saveConnectionEl = document.getElementById('saveConnection');
    const loadProjectsEl = document.getElementById('loadProjects');
    const loadIssuesEl = document.getElementById('loadIssues');
    const settingsEl = document.getElementById('settings');
    const statusEl = document.getElementById('status');
    const issueDetailEl = document.getElementById('issueDetail');
    const issueDetailMetaEl = document.getElementById('issueDetailMeta');
    const issueDetailDescriptionEl = document.getElementById('issueDetailDescription');
    const issueJournalsEl = document.getElementById('issueJournals');

    function escapeHtml(text) {
      return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderIssueDetail(issue) {
      if (!issue) {
        issueDetailEl.classList.remove('visible');
        return;
      }
      const status = issue.status?.name || '?';
      const priority = issue.priority?.name || '?';
      const assignee = issue.assigned_to?.name || 'Unassigned';
      issueDetailMetaEl.textContent = 'Status: ' + status + '  ·  Priority: ' + priority + '  ·  Assignee: ' + assignee;
      issueDetailDescriptionEl.textContent = issue.description || '(no description)';

      const journals = (issue.journals || []).filter((j) => j.notes && j.notes.trim());
      if (journals.length > 0) {
        issueJournalsEl.style.display = '';
        issueJournalsEl.innerHTML = journals.map((j) => {
          const author = escapeHtml(j.user?.name || 'Unknown');
          const date = j.created_on ? new Date(j.created_on).toLocaleDateString() : '';
          const notes = escapeHtml(j.notes);
          return '<div class="journal-entry"><div class="journal-meta">' + author + (date ? ' · ' + date : '') + '</div><div class="journal-notes">' + notes + '</div></div>';
        }).join('');
      } else {
        issueJournalsEl.style.display = 'none';
        issueJournalsEl.innerHTML = '';
      }
      issueDetailEl.classList.add('visible');
    }

    function syncVisibility() {
      codexModelBlockEl.style.display = backendEl.value === 'codex' ? '' : 'none';
      ollamaModelBlockEl.style.display = backendEl.value === 'ollama' ? '' : 'none';
    }

    function renderOptions(selectEl, items, selectedValue, placeholder, mapper) {
      selectEl.innerHTML = '';
      const placeholderOption = document.createElement('option');
      placeholderOption.value = '';
      placeholderOption.textContent = placeholder;
      selectEl.appendChild(placeholderOption);

      items.forEach((item) => {
        const option = document.createElement('option');
        const mapped = mapper(item);
        option.value = mapped.value;
        option.textContent = mapped.label;
        if (mapped.description) option.title = mapped.description;
        selectEl.appendChild(option);
      });

      selectEl.value = selectedValue || '';
    }

    function collectPayload() {
      return {
        baseUrl: baseUrlEl.value.trim(),
        accessToken: accessTokenEl.value.trim(),
        selectedProjectId: projectEl.value,
        selectedIssueId: issueEl.value,
        backend: backendEl.value,
        codexModel: codexModelEl.value.trim(),
        ollamaModel: ollamaModelEl.value.trim(),
        scope: scopeEl.value,
        autoApplyTrusted: autoApplyTrustedEl.checked
      };
    }

    function setBusy(busy) {
      state.busy = busy;
      [
        baseUrlEl, accessTokenEl, projectEl, issueEl, scopeEl, backendEl,
        codexModelEl, ollamaModelEl, autoApplyTrustedEl, analyzeEl, changeCodeEl,
        saveConnectionEl, loadProjectsEl, loadIssuesEl, settingsEl
      ].forEach((el) => { el.disabled = busy; });
      analyzeEl.textContent = busy ? 'Running…' : 'Analyze Only';
      changeCodeEl.textContent = busy ? 'Running…' : 'Analyze + Change Code';
    }

    function applyState(next) {
      Object.assign(state, next);
      baseUrlEl.value = state.baseUrl || '';
      accessTokenEl.value = state.accessToken || '';
      backendEl.value = state.backend || 'codex';
      codexModelEl.value = state.codexModel || '';
      ollamaModelEl.value = state.ollamaModel || 'llama3.2';
      scopeEl.value = state.scope || 'activeFile';
      autoApplyTrustedEl.checked = Boolean(state.autoApplyTrusted);
      renderOptions(projectEl, state.projects || [], state.selectedProjectId, 'Select a project', (project) => ({
        value: project.id,
        label: project.name
      }));
      renderOptions(issueEl, state.issues || [], state.selectedIssueId, 'Select an issue', (issue) => ({
        value: issue.id,
        label: '#' + issue.id + ' [' + (issue.status || '?') + '] ' + issue.subject,
        description: issue.updatedOn || ''
      }));
      statusEl.textContent = state.status || 'Ready.';
      renderIssueDetail(state.selectedIssue || null);
      syncVisibility();
      setBusy(Boolean(state.busy));
      vscode.setState(state);
    }

    saveConnectionEl.addEventListener('click', () => {
      vscode.postMessage({ type: 'saveConnection', payload: collectPayload() });
    });

    loadProjectsEl.addEventListener('click', () => {
      vscode.postMessage({ type: 'loadProjects', payload: collectPayload() });
    });

    loadIssuesEl.addEventListener('click', () => {
      vscode.postMessage({
        type: 'loadIssues',
        payload: {
          ...collectPayload(),
          projectId: projectEl.value
        }
      });
    });

    analyzeEl.addEventListener('click', () => {
      vscode.postMessage({
        type: 'run',
        payload: {
          ...collectPayload(),
          action: 'analysis'
        }
      });
    });

    changeCodeEl.addEventListener('click', () => {
      vscode.postMessage({
        type: 'run',
        payload: {
          ...collectPayload(),
          action: 'patch'
        }
      });
    });

    settingsEl.addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' });
    });

    projectEl.addEventListener('change', () => {
      applyState({
        selectedProjectId: projectEl.value,
        selectedIssueId: '',
        issues: [],
        selectedIssue: null
      });
    });

    issueEl.addEventListener('change', () => {
      applyState({ selectedIssueId: issueEl.value, selectedIssue: null });
      vscode.postMessage({
        type: 'selectIssue',
        payload: { ...collectPayload(), selectedIssueId: issueEl.value }
      });
    });

    backendEl.addEventListener('change', syncVisibility);

    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'state') {
        applyState(event.data.payload);
      }
    });

    applyState(vscode.getState() || state);
  </script>
</body>
</html>`;
  }
}

module.exports = {
  SidebarProvider,
};
