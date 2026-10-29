export interface SelectionUndo {
    text: string;
    historyIndexes: number[];
}

export interface HistorySnapshot {
    text: string;
    groupId: number;
}

/** Find the prior selected text and history entries that contributed to it. */
export function findSelectionUndo(
    currentText: string,
    snapshots: readonly HistorySnapshot[],
    selectionStart: number,
    selectionEnd: number,
): SelectionUndo {
    let selectedRange = { start: selectionStart, end: selectionEnd };
    let workingText = currentText;
    let restoredText = currentText.slice(selectionStart, selectionEnd);
    let index = snapshots.length - 1;

    while (index >= 0) {
        const groupId = snapshots[index].groupId;
        const textBeforeGroup = restoredText;
        const groupIndexes: number[] = [];

        while (index >= 0 && snapshots[index].groupId === groupId) {
            const candidateText = snapshots[index].text;
            const candidateRange = mapSelectionToPreviousText(
                workingText,
                candidateText,
                selectedRange.start,
                selectedRange.end,
            );
            restoredText = candidateText.slice(candidateRange.start, candidateRange.end);
            selectedRange = candidateRange;
            workingText = candidateText;
            groupIndexes.push(index);
            index--;
        }

        // Skip edit groups that only changed text outside the selected range.
        // Undo the newest group that changed the selected text, one group per command.
        if (restoredText !== textBeforeGroup) {
            return { text: restoredText, historyIndexes: groupIndexes };
        }
    }

    return { text: currentText.slice(selectionStart, selectionEnd), historyIndexes: [] };
}

function mapSelectionToPreviousText(
    current: string,
    previous: string,
    selectionStart: number,
    selectionEnd: number,
): { start: number; end: number } {
    let prefix = 0;
    const sharedLength = Math.min(current.length, previous.length);
    while (prefix < sharedLength && current[prefix] === previous[prefix]) {prefix++;}

    let suffix = 0;
    while (
        suffix < current.length - prefix &&
        suffix < previous.length - prefix &&
        current[current.length - 1 - suffix] === previous[previous.length - 1 - suffix]
    ) {suffix++;}

    const currentChangeEnd = current.length - suffix;
    const previousChangeEnd = previous.length - suffix;
    const delta = previousChangeEnd - currentChangeEnd;
    const mapStart = (offset: number) => {
        if (offset <= prefix) {return offset;}
        if (offset >= currentChangeEnd) {return Math.max(prefix, offset + delta);}
        return prefix;
    };
    const mapEnd = (offset: number) => {
        if (offset <= prefix) {return offset;}
        if (offset >= currentChangeEnd) {return Math.max(prefix, offset + delta);}
        return previousChangeEnd;
    };

    return {
        start: Math.min(mapStart(selectionStart), previous.length),
        end: Math.min(Math.max(mapEnd(selectionEnd), mapStart(selectionStart)), previous.length),
    };
}
