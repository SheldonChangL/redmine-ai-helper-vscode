# Project State

## Project

- Name: `redmine-ai-helper-vscode`
- Current version: `0.0.3`
- Main installable package: `redmine-ai-helper-vscode-0.0.3.vsix`
- Project path: `/Users/sheldon.chang/Documents/Playground/redmine-ai-helper-vscode`

## Current Scope

This extension is focused on a VS Code workflow that connects Redmine issue context with the user's current code scope and can apply AI-generated code changes back into the workspace.

## Implemented

- Activity Bar sidebar UI
- Redmine base URL input in sidebar
- Redmine access token input in sidebar
- Redmine connection persistence
  - Base URL stored in VS Code global state
  - Access token stored in VS Code secret storage
- Project loading from Redmine
- Open issues assigned to `me` loading for the selected project
- Scope selection in sidebar
  - Current file
  - Current file folder
  - Workspace
- Explorer context-menu analysis/generate-patch actions for a selected file or folder
- AI backend support
  - Codex
  - Claude CLI
  - Ollama
- Codex invocation updated with `--skip-git-repo-check`
- Analysis-only flow
  - Opens markdown output in editor
- Code-change flow
  - Requests unified diff patch from AI
  - Validates patch with `git apply --check`
  - If trust mode is off, opens patch preview and asks user whether to apply
  - If trust mode is on, applies validated patch directly
- Trusted auto-apply preference persisted in global state
- Packaged VSIX generation
- Release workflow for GitHub Actions

## Packaging / Distribution

- Release-ready metadata added to `package.json`
- `LICENSE` added
- GitHub Actions workflow added at `.github/workflows/release-vsix.yml`
- Current packaged artifact:
  - `/Users/sheldon.chang/Documents/Playground/redmine-ai-helper-vscode/redmine-ai-helper-vscode-0.0.3.vsix`

## Known Limitations

- `package.json` still contains placeholder values for:
  - `repository.url`
  - `homepage`
  - `bugs.url`
- No end-to-end live verification has been run against a real Redmine server and real Codex/Claude/Ollama execution in the installed VSIX
- Patch application currently depends on `git apply`, so the target workspace should be a git working tree with paths matching the generated patch
- The extension currently applies patches as a whole; it does not yet offer hunk-by-hunk acceptance
- Sidebar does not yet display full issue details such as description, journals, or acceptance criteria inline
- No automated tests are in place

## Recommended Next Steps

1. Replace placeholder GitHub URLs in `package.json`
2. Run end-to-end validation against a real Redmine project and at least one real backend
3. Add inline issue detail display in the sidebar after issue selection
4. Add a post-apply summary showing changed files and diff shortcuts
5. Add error handling improvements for non-git directories and partial patch failures
6. Add automated smoke tests for core prompt/apply flows

## Important Files

- `src/core.js`
  - Redmine API calls
  - scope resolution
  - code collection
  - backend execution
  - patch validation and apply flow
- `src/panel.js`
  - sidebar UI
  - Redmine project/issue loading
  - trust-mode toggle
  - run actions
- `src/extension.js`
  - command registration
  - sidebar provider wiring
- `package.json`
  - extension manifest
  - commands
  - configuration
  - packaging metadata
- `.github/workflows/release-vsix.yml`
  - release packaging workflow

## Status Summary

The VS Code extension is beyond scaffold stage and is usable for manual testing. The core product loop is in place:

- connect to Redmine
- select project
- select assigned issue
- choose scope
- analyze code or generate/apply changes

It should currently be treated as a functional prototype / pre-release build rather than a fully production-hardened extension.
