# Redmine AI Helper for VS Code

> Connect Redmine issues to your code and let AI analyze or patch it — right inside VS Code.

**Author:** Sheldon Chang
**Publisher:** sheldonchangl
**Version:** 0.0.4

---

## Features

- **Sidebar UI** — enter Redmine URL, access token, project, and issue in one place
- **Inline issue details** — view issue description, metadata, and journal comments directly in the sidebar after selecting an issue
- **Automatic update notifications** — get notified when a new version is available (checks once per 24 h)
- **Multiple AI backends** — supports Codex CLI, Claude CLI, and Ollama
- **Flexible scope** — analyze the current file, current folder, or the entire workspace
- **Explorer context menu** — right-click any file or folder to analyze or generate a patch
- **Analysis mode** — opens AI review notes in a markdown editor tab
- **Patch mode** — generates a unified diff, lets you accept or reject individual hunks, validates with `git apply --check`, then applies to your workspace
- **Trust mode** — auto-applies validated patches without a confirmation step
- **Post-apply summary** — shows which files changed after a patch is applied, with an "Open Changes" shortcut

---

## Installation

### From GitHub Releases (recommended)

1. Go to the [Releases page](https://github.com/SheldonChangL/redmine-ai-helper-vscode/releases).
2. Download the latest `.vsix` file.
3. In VS Code, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
4. Run **Extensions: Install from VSIX…** and select the downloaded file.

### From Open VSX Registry

Search for **Redmine AI Helper** on [open-vsx.org](https://open-vsx.org) once the extension is published there.

---

## Requirements

At least one AI backend must be installed and accessible from your terminal:

| Backend | Install |
|---------|---------|
| [Codex CLI](https://github.com/openai/codex) | `npm install -g @openai/codex` |
| [Claude CLI](https://github.com/anthropics/claude-code) | `npm install -g @anthropic-ai/claude-code` |
| [Ollama](https://ollama.com) | Download from ollama.com |

The target workspace must be a **git repository** for patch application (`git apply` is used internally).

---

## Quick Start

1. Click the **Redmine AI** icon in the Activity Bar.
2. Enter your **Redmine Base URL** and **Access Token**, then click **Load Projects**.
3. Select a project and click **Load My Issues**.
4. Select an issue — its description and comments appear below the dropdown.
5. Choose an **Analysis Scope** and **Backend**.
6. Click **Analyze Only** for a review, or **Analyze + Change Code** to generate and apply a patch.

---

## Commands

| Command | Description |
|---------|-------------|
| `Redmine AI: Focus Sidebar` | Open the sidebar panel |
| `Redmine AI: Analyze Workspace for Issue` | Analyze the full workspace |
| `Redmine AI: Generate Patch for Workspace` | Generate a patch for the full workspace |
| `Redmine AI: Analyze Active File for Issue` | Analyze the currently open file |
| `Redmine AI: Generate Patch for Active File` | Generate a patch for the active file |
| `Redmine AI: Analyze This File or Folder` | Analyze a file/folder from the Explorer |
| `Redmine AI: Generate Patch for This File or Folder` | Generate a patch from the Explorer |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `redmineAiHelper.aiBackend` | `codex` | AI backend: `codex`, `claude`, or `ollama` |
| `redmineAiHelper.codexModel` | _(empty)_ | Optional model override for Codex CLI (`-m`) |
| `redmineAiHelper.ollamaModel` | `llama3.2` | Ollama model name |
| `redmineAiHelper.maxFileBytes` | `51200` | Max size per file included in the AI prompt |
| `redmineAiHelper.maxTotalBytes` | `204800` | Max total code context sent to the AI |
| `redmineAiHelper.includeExtensions` | _(list)_ | File extensions to scan |
| `redmineAiHelper.excludeDirectories` | _(list)_ | Directories to skip when scanning |

---

## Release Flow

Push a version tag to trigger the CI/CD pipeline:

```bash
git tag v0.0.5
git push origin v0.0.5
```

GitHub Actions will:
1. Run all tests
2. Package the `.vsix`
3. Create a GitHub Release with the `.vsix` attached
4. Publish to Open VSX Registry (if `OVSX_TOKEN` secret is configured)

---

## Development

1. Clone the repository and open it in VS Code.
2. Press `F5` to launch an Extension Development Host.
3. Open a git-tracked workspace in the new window.
4. Use the **Redmine AI** sidebar to connect and run the extension.
5. Run `npm test` to execute the unit test suite.

---

## Notes

- Plain JavaScript — no build step required.
- Patch validation uses `git apply --check` before any file is modified.
- If the AI returns malformed output, the raw text is opened for inspection instead of touching files.
- Hunk-by-hunk selection is available in non-trust mode: deselect individual hunks before applying.
