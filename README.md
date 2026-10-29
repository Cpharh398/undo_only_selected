# Undo Only Selected

Undo or redo edits for selected text or lines without changing unrelated parts of the document.

## Features

- **Undo Only Selected** and **Redo Selected Lines** operate on the selected range, one edit group at a time. Continuous typing is grouped together; clicking or moving the cursor starts a new group.
- Commands are available from the Command Palette and the editor context menu.
- Default shortcuts use `Control+Command` on macOS and `Control+Alt` on Windows and Linux. You can change them in Keyboard Shortcuts.

## Demo

[Watch the demo video](Demo.mov)

## Install

1. Download the latest `.vsix` file from the project's [GitHub Releases](https://github.com/Cpharh398/undo_only_selected/releases) page. If it is shared in the repository instead, open the `.vsix` file there and select **Download raw file**.
2. In VS Code, open the Command Palette (`Ctrl+Shift+P` on Windows/Linux or `Command+Shift+P` on macOS).
3. Run **Extensions: Install from VSIX…** and select the downloaded file.
4. Reload VS Code if prompted.

You can also install it from a terminal after downloading the file:

```sh
code --install-extension path/to/undo-only-selected-0.0.3.vsix
```
