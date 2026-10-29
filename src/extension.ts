import * as vscode from 'vscode';
import { findSelectionUndo, type HistorySnapshot } from './undo';
import { handleDocumentClose, handleDocumentOpen } from './documentLifecycle';

const maxHistoryEntries = 100;
const typingGroupPauseMs = 800;

interface ActiveTypingGroup {
    id: number;
    operation: 'insert' | 'delete';
    expectedOffset: number;
    lastEditAt: number;
}

const history = new Map<string, HistorySnapshot[]>();
const redoHistory = new Map<string, HistorySnapshot[]>();
const knownText = new Map<string, string>();
const pendingHistoryText = new Map<string, string>();
const activeTypingGroups = new Map<string, ActiveTypingGroup>();
let nextHistoryGroupId = 0;

function createHistoryGroupId(): number {
    nextHistoryGroupId++;
    return nextHistoryGroupId;
}

function appendSnapshot(
    snapshotsByDocument: Map<string, HistorySnapshot[]>,
    uri: string,
    text: string,
    groupId: number,
): void {
    const snapshots = snapshotsByDocument.get(uri) ?? [];
    // Keep one document snapshot per undo group, even when typing generated
    // many individual document-change events.
    if (snapshots[snapshots.length - 1]?.groupId !== groupId) {
        snapshots.push({ text, groupId });
    }
    if (snapshots.length > maxHistoryEntries) {snapshots.shift();}
    snapshotsByDocument.set(uri, snapshots);
}

function getHistoryGroupId(event: vscode.TextDocumentChangeEvent, previousText: string, uri: string): number {
    const changes = event.contentChanges;
    if (event.reason !== undefined || changes.length !== 1) {
        activeTypingGroups.delete(uri);
        return createHistoryGroupId();
    }

    const change = changes[0];
    let operation: ActiveTypingGroup['operation'];
    let expectedOffset: number;
    if (change.rangeLength === 0 && change.text.length === 1 && change.text !== '\n' && change.text !== '\r') {
        operation = 'insert';
        expectedOffset = change.rangeOffset + change.text.length;
    } else if (change.text === '' && change.rangeLength === 1) {
        const removedCharacter = previousText.slice(change.rangeOffset, change.rangeOffset + change.rangeLength);
        if (removedCharacter.length !== 1 || removedCharacter === '\n' || removedCharacter === '\r') {
            activeTypingGroups.delete(uri);
            return createHistoryGroupId();
        }
        operation = 'delete';
        expectedOffset = change.rangeOffset;
    } else {
        activeTypingGroups.delete(uri);
        return createHistoryGroupId();
    }

    const now = Date.now();
    const previousGroup = activeTypingGroups.get(uri);
    const continuesPreviousGroup = previousGroup !== undefined
        && previousGroup.operation === operation
        && now - previousGroup.lastEditAt <= typingGroupPauseMs
        && (operation === 'insert'
            ? change.rangeOffset === previousGroup.expectedOffset
            : change.rangeOffset === previousGroup.expectedOffset
                || change.rangeOffset + change.rangeLength === previousGroup.expectedOffset);
    const groupId = continuesPreviousGroup ? previousGroup.id : createHistoryGroupId();

    activeTypingGroups.set(uri, { id: groupId, operation, expectedOffset, lastEditAt: now });
    return groupId;
}

async function applyHistoryCommand(
    editor: vscode.TextEditor,
    range: vscode.Range,
    sourceHistory: Map<string, HistorySnapshot[]>,
    destinationHistory: Map<string, HistorySnapshot[]>,
    action: 'undo' | 'redo',
): Promise<void> {
    const uri = editor.document.uri.toString();
    activeTypingGroups.delete(uri);
    const snapshots = sourceHistory.get(uri);
    if (!snapshots || snapshots.length === 0) {
        vscode.window.showInformationMessage(`There is no earlier ${action} for this document.`);
        return;
    }

    const currentText = editor.document.getText();
    const selectionStart = editor.document.offsetAt(range.start);
    const selectionEnd = editor.document.offsetAt(range.end);
    const result = findSelectionUndo(currentText, snapshots, selectionStart, selectionEnd);
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

    appendSnapshot(destinationHistory, uri, currentText, createHistoryGroupId());
    for (const index of result.historyIndexes) {snapshots.splice(index, 1);}
    if (snapshots.length === 0) {sourceHistory.delete(uri);}
    knownText.set(uri, editor.document.getText());
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
            activeTypingGroups.delete(uri);
            handleDocumentOpen(uri, document.getText(), { history, redoHistory, knownText, pendingHistoryText });
        }),
        vscode.workspace.onDidCloseTextDocument(document => {
            const uri = document.uri.toString();
            activeTypingGroups.delete(uri);
            handleDocumentClose(uri, { history, redoHistory, knownText, pendingHistoryText });
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            const uri = event.document.uri.toString();
            const current = event.document.getText();
            const expectedHistoryText = pendingHistoryText.get(uri);

            if (expectedHistoryText === current) {
                pendingHistoryText.delete(uri);
                activeTypingGroups.delete(uri);
            } else {
                redoHistory.delete(uri);
                const previous = knownText.get(uri);
                if (previous !== undefined && previous !== current) {
                    const groupId = getHistoryGroupId(event, previous, uri);
                    appendSnapshot(history, uri, previous, groupId);
                } else {
                    activeTypingGroups.delete(uri);
                }
            }
            knownText.set(uri, current);
        }),
        vscode.window.onDidChangeTextEditorSelection(event => {
            const uri = event.textEditor.document.uri.toString();
            const activeGroup = activeTypingGroups.get(uri);
            if (!activeGroup) {return;}

            if (
                event.kind === vscode.TextEditorSelectionChangeKind.Mouse
                || event.kind === vscode.TextEditorSelectionChangeKind.Command
                || event.selections.length !== 1
                || !event.selections[0].isEmpty
            ) {
                activeTypingGroups.delete(uri);
                return;
            }

            const activeOffset = event.textEditor.document.offsetAt(event.selections[0].active);
            if (activeOffset !== activeGroup.expectedOffset) {activeTypingGroups.delete(uri);}
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
    );
}

export function deactivate() {}
