import * as vscode from 'vscode';
import { findSelectionUndo } from './undo';
import { handleDocumentClose, handleDocumentOpen } from './documentLifecycle';

// Each entry is the document text immediately before a user edit or history command.
const maxHistoryEntries = 100;

const history = new Map<string, string[]>();
const redoHistory = new Map<string, string[]>();
const knownText = new Map<string, string>();
const pendingHistoryText = new Map<string, string>();

function appendSnapshot(snapshotsByDocument: Map<string, string[]>, uri: string, text: string): void {
    const snapshots = snapshotsByDocument.get(uri) ?? [];
    snapshots.push(text);
    if (snapshots.length > maxHistoryEntries) {snapshots.shift();}
    snapshotsByDocument.set(uri, snapshots);
}

async function applyHistoryCommand(
    editor: vscode.TextEditor,
    range: vscode.Range,
    sourceHistory: Map<string, string[]>,
    destinationHistory: Map<string, string[]>,
    action: 'undo' | 'redo',
    extendEmptyFinalLine = false,
): Promise<void> {
    const uri = editor.document.uri.toString();
    const snapshots = sourceHistory.get(uri);
    if (!snapshots || snapshots.length === 0) {
        vscode.window.showInformationMessage(`There is no earlier ${action} for this document.`);
        return;
    }

    const currentText = editor.document.getText();
    const selectionStart = editor.document.offsetAt(range.start);
    const selectionEnd = editor.document.offsetAt(range.end);
    // An empty final line may only expose its preceding delimiter. Extend the
    // history lookup boundary so edits at the end of that line can be recovered.
    const historySelectionEnd = extendEmptyFinalLine
        ? selectionEnd + 1
        : selectionEnd;
    const result = findSelectionUndo(currentText, snapshots, selectionStart, historySelectionEnd);
    const currentRangeText = editor.document.getText(range);

    if (result.text === currentRangeText) {
        vscode.window.showInformationMessage(`The target has no ${action} to apply.`);
        return;
    }

    const expectedText = currentText.slice(0, selectionStart) + result.text + currentText.slice(selectionEnd);
    pendingHistoryText.set(uri, expectedText);
    const applied = await editor.edit(editBuilder => {
        editBuilder.replace(range, result.text);
    });

    if (!applied) {
        pendingHistoryText.delete(uri);
        vscode.window.showErrorMessage(`Could not ${action} the target.`);
        return;
    }

    appendSnapshot(destinationHistory, uri, currentText);
    for (const index of result.historyIndexes) {snapshots.splice(index, 1);}
    if (snapshots.length === 0) {sourceHistory.delete(uri);}
    knownText.set(uri, editor.document.getText());
}

function currentLineRange(document: vscode.TextDocument, lineNumber: number): vscode.Range {
    const line = document.lineAt(lineNumber);
    if (line.text.length > 0 || lineNumber < document.lineCount - 1) {
        return line.rangeIncludingLineBreak;
    }

    if (lineNumber > 0) {
        // An empty final line has no text or following delimiter, so include
        // its preceding line break to give history mapping a nonempty range.
        return new vscode.Range(document.lineAt(lineNumber - 1).range.end, line.range.end);
    }

    return line.range;
}

export function activate(context: vscode.ExtensionContext) {
    
    for (const document of vscode.workspace.textDocuments) {
        knownText.set(document.uri.toString(), document.getText());
    }

    const undoStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    undoStatus.text = '$(discard) Undo Selected';
    undoStatus.tooltip = 'Undo changes affecting the selected text';
    undoStatus.command = 'selection-undo.undoSelection';
    undoStatus.show();
    context.subscriptions.push(undoStatus);

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(document => {
            const uri = document.uri.toString();
            handleDocumentOpen(uri, document.getText(), { history, redoHistory, knownText, pendingHistoryText });
        }),
        vscode.workspace.onDidCloseTextDocument(document => {
            const uri = document.uri.toString();
            handleDocumentClose(uri, { history, redoHistory, knownText, pendingHistoryText });
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            const uri = event.document.uri.toString();
            const current = event.document.getText();
            const expectedHistoryText = pendingHistoryText.get(uri);

            // Edits initiated by these commands are handled below. A user edit,
            // however, starts a new branch and clears any redo history.
            if (expectedHistoryText === current) {
                pendingHistoryText.delete(uri);
            } else {
                redoHistory.delete(uri);
                const previous = knownText.get(uri);
                if (previous !== undefined && previous !== current) {
                    appendSnapshot(history, uri, previous);
                }
            }
            knownText.set(uri, current);
        }),
        vscode.commands.registerCommand('selection-undo.undoSelection', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {return;}

            const selection = editor.selection;
            if (selection.isEmpty) {
                vscode.window.showWarningMessage('Select the text you want to undo first.');
                return;
            }

            await applyHistoryCommand(editor, selection, history, redoHistory, 'undo');
        }),
        vscode.commands.registerCommand('selection-undo.redoSelection', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {return;}
            const selection = editor.selection;
            if (selection.isEmpty) {
                vscode.window.showWarningMessage('Select the lines you want to redo first.');
                return;
            }
            await applyHistoryCommand(editor, selection, redoHistory, history, 'redo');
        }),
        vscode.commands.registerCommand('selection-undo.undoCurrentLine', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {return;}
            const lineNumber = editor.selection.active.line;
            const line = editor.document.lineAt(lineNumber);
            const range = currentLineRange(editor.document, lineNumber);
            const extendEmptyFinalLine = line.text.length === 0 && lineNumber === editor.document.lineCount - 1;
            await applyHistoryCommand(editor, range, history, redoHistory, 'undo', extendEmptyFinalLine);
        }),
        vscode.commands.registerCommand('selection-undo.redoCurrentLine', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {return;}
            const lineNumber = editor.selection.active.line;
            const line = editor.document.lineAt(lineNumber);
            const range = currentLineRange(editor.document, lineNumber);
            const extendEmptyFinalLine = line.text.length === 0 && lineNumber === editor.document.lineCount - 1;
            await applyHistoryCommand(editor, range, redoHistory, history, 'redo', extendEmptyFinalLine);
        }),
    );
}

export function deactivate() {}
