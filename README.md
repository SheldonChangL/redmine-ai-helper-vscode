# Redmine AI Helper for VS Code

This extension runs the "Redmine issue + code analysis" flow directly inside VS Code and can apply code changes back into your workspace.

## Features

- Activity-bar sidebar for entering Redmine URL, access token, project, issue, backend, scope, and trust mode
- Load Redmine projects and list open issues assigned to `me`
- Analyze the current file, current file folder, or the whole workspace
- Explorer context-menu commands for a selected file or folder
- Fetch Redmine issue details by ID
- Scan local code context and send it to `codex`, `claude`, or `ollama`
- Open analysis results in a markdown editor tab
- Generate validated patches, preview them, and apply them into the workspace
- Optional trusted mode to auto-apply validated changes without a confirmation step

## Commands

- `Redmine AI: Focus Sidebar`
- `Redmine AI: Analyze Workspace for Issue`
- `Redmine AI: Generate Patch for Workspace`
- `Redmine AI: Analyze Active File for Issue`
- `Redmine AI: Generate Patch for Active File`
- `Redmine AI: Analyze This File or Folder`
- `Redmine AI: Generate Patch for This File or Folder`

## Required Settings

The sidebar now lets you enter Redmine URL and access token directly. These settings still matter:

- `redmineAiHelper.aiBackend`
- `redmineAiHelper.codexModel` if you want to force a Codex model
- `redmineAiHelper.ollamaModel` when using Ollama

## Development

1. Open this folder in VS Code.
2. Press `F5` to start an Extension Development Host.
3. In the new window, open a project you want to analyze.
4. Use the `Redmine AI` activity-bar icon.
5. Enter your Redmine base URL and access token.
6. Load projects, then load your open issues for the selected project.
7. Pick `Analyze Only` or `Analyze + Change Code`.

## Install For Normal Users

Use one of these two paths:

1. Install a packaged `.vsix`
   - Open VS Code
   - Open `Extensions`
   - Click `...`
   - Choose `Install from VSIX...`
   - Select the packaged `.vsix` file

2. Install from a GitHub Release asset
   - Download the `.vsix` file from the latest GitHub Release
   - Use `Install from VSIX...` in VS Code

## GitHub Release Flow

The repository includes [release-vsix.yml](.github/workflows/release-vsix.yml), which packages the extension and uploads the `.vsix` to a GitHub Release whenever you push a tag like `v0.0.3`.

Typical release flow:

1. Put this extension project in its own GitHub repository
2. Update `repository`, `homepage`, and `bugs` in [package.json](package.json)
3. Commit changes
4. Tag a release:
   - `git tag v0.0.3`
   - `git push origin v0.0.3`
5. GitHub Actions will build the `.vsix` and attach it to the Release

## Notes

- The project uses plain JavaScript to avoid a build step.
- Code-changing mode validates the generated patch with `git apply --check` before offering to apply it.
- If trusted mode is off, the extension opens the patch preview and asks whether to apply it.
- If the AI returns malformed patch text, or validation fails, the raw patch output is opened instead of modifying files.
- The `repository`, `homepage`, and `bugs` URLs currently use placeholders and should be updated before publishing from your real GitHub repository.
