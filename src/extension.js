'use strict';

const vscode = require('vscode');
const { runTask } = require('./core');
const { SidebarProvider } = require('./panel');

const EXTENSION_VERSION = require('../package.json').version;
const UPDATE_CHECK_KEY = 'redmineAiHelper.lastUpdateCheck';
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function checkForUpdates(context) {
  const lastCheck = context.globalState.get(UPDATE_CHECK_KEY, 0);
  if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;

  try {
    const response = await fetch(
      'https://api.github.com/repos/SheldonChangL/redmine-ai-helper-vscode/releases/latest',
      { headers: { 'User-Agent': 'redmine-ai-helper-vscode' } },
    );
    if (!response.ok) return;

    const release = await response.json();
    await context.globalState.update(UPDATE_CHECK_KEY, Date.now());

    const latestVersion = String(release.tag_name || '').replace(/^v/, '');
    if (!latestVersion || latestVersion === EXTENSION_VERSION) return;

    // Numeric semver comparison
    const cur = EXTENSION_VERSION.split('.').map(Number);
    const lat = latestVersion.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((lat[i] || 0) > (cur[i] || 0)) {
        const choice = await vscode.window.showInformationMessage(
          `Redmine AI Helper v${latestVersion} is available (you have v${EXTENSION_VERSION}).`,
          'Download',
          'Dismiss',
        );
        if (choice === 'Download') {
          vscode.env.openExternal(vscode.Uri.parse(release.html_url));
        }
        return;
      }
      if ((lat[i] || 0) < (cur[i] || 0)) return;
    }
  } catch {
    // Network errors are silent
  }
}

async function runCommand(context, outputChannel, options) {
  try {
    await runTask(context, outputChannel, options);
  } catch (error) {
    vscode.window.showErrorMessage(error.message);
  }
}

function activate(context) {
  const outputChannel = vscode.window.createOutputChannel('Redmine AI Helper');
  context.subscriptions.push(outputChannel);

  // Check for updates in the background — non-blocking
  checkForUpdates(context).catch(() => {});

  const sidebar = new SidebarProvider(context, {
    runFromPanel: (payload) => runTask(context, outputChannel, payload),
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('redmineAiHelper.sidebar', sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('redmineAiHelper.openSidebar', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.redmineAiHelper');
      try {
        await vscode.commands.executeCommand('redmineAiHelper.sidebar.focus');
      } catch {
        // Revealing the view container is enough on older VS Code builds.
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('redmineAiHelper.analyzeIssue', () => runCommand(context, outputChannel, {
      action: 'analysis',
      scope: 'workspace',
    })),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('redmineAiHelper.generatePatch', () => runCommand(context, outputChannel, {
      action: 'patch',
      scope: 'workspace',
    })),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('redmineAiHelper.analyzeActiveFile', () => runCommand(context, outputChannel, {
      action: 'analysis',
      scope: 'activeFile',
    })),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('redmineAiHelper.generatePatchActiveFile', () => runCommand(context, outputChannel, {
      action: 'patch',
      scope: 'activeFile',
    })),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('redmineAiHelper.analyzeExplorerResource', (resourceUri) => runCommand(context, outputChannel, {
      action: 'analysis',
      scope: 'resource',
      resourceUri,
    })),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('redmineAiHelper.generatePatchExplorerResource', (resourceUri) => runCommand(context, outputChannel, {
      action: 'patch',
      scope: 'resource',
      resourceUri,
    })),
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
