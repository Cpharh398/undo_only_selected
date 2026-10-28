# Undo Only Selected: Quickstart

Undo or redo edits in a selected range, or work on the line containing the cursor. Commands are available from the Command Palette and the editor context menu.

## Commands and shortcuts

| Command | How to use it | macOS | Windows/Linux |
| --- | --- | --- | --- |
| Undo Only Selected | Select text or lines, then run the command. | `Control+Command+U` | `Ctrl+Alt+U` |
| Redo Selected Lines | Select the same text or lines you undid, then run the command. | `Control+Command+R` | `Ctrl+Alt+R` |
| Undo Current Line | Place the cursor on the line. | `Control+Command+Shift+U` | `Ctrl+Alt+Shift+U` |
| Redo Current Line | Place the cursor on the line you want to redo. | `Control+Command+Shift+R` | `Ctrl+Alt+Shift+R` |

Change shortcuts in **Preferences: Open Keyboard Shortcuts**.

## Contribution 

1. Open root folder in VS Code and run `npm install` if dependencies are not installed.
2. Press `F5` to launch an Extension Development Host. The extension activates automatically and starts tracking edits.
3. Run `npm test` to compile, lint, and run the VS Code extension tests.

Useful individual commands:

- `npm run compile` builds the TypeScript source into `out/`.
- `npm run lint` checks the extension source.

The extension implementation is in `src/extension.ts`; range mapping is in `src/undo.ts`; tests are in `src/test/extension.test.ts`.
