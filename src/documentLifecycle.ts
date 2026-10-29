import type { HistorySnapshot } from './undo';

export interface DocumentLifecycleState {
    history: Map<string, HistorySnapshot[]>;
    redoHistory: Map<string, HistorySnapshot[]>;
    knownText: Map<string, string>;
    pendingHistoryText: Map<string, string>;
}

export function handleDocumentClose(uri: string, state: DocumentLifecycleState): void {
    // The document's text and edit history remain valid for a same-content reopen.
    state.pendingHistoryText.delete(uri);
}

export function handleDocumentOpen(uri: string, text: string, state: DocumentLifecycleState): void {
    const previousText = state.knownText.get(uri);

    // Changes made outside the extension while the file was closed invalidate
    // snapshots that were based on its previous contents.
    if (previousText !== undefined && previousText !== text) {
        state.history.delete(uri);
        state.redoHistory.delete(uri);
        state.pendingHistoryText.delete(uri);
    }
    state.knownText.set(uri, text);
}
