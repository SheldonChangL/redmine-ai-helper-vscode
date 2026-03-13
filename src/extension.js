'use strict';

const vscode = require('vscode');
const { runTask } = require('./core');
const { SidebarProvider } = require('./panel');

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
