export interface SelectionUndo {
    text: string;
    historyIndexes: number[];
}

/** Find the prior selected text and history entries that contributed to it. */
export function findSelectionUndo(
    currentText: string,
    snapshots: readonly string[],
    selectionStart: number,
    selectionEnd: number,
): SelectionUndo {
    let selectedRange = { start: selectionStart, end: selectionEnd };
    let workingText = currentText;
    let restoredText = currentText.slice(selectionStart, selectionEnd);
    const historyIndexes: number[] = [];

    for (let index = snapshots.length - 1; index >= 0; index--) {
        const candidateText = snapshots[index];
        const candidateRange = mapSelectionToPreviousText(
            workingText,
            candidateText,
            selectedRange.start,
            selectedRange.end,
        );
        const candidateSelection = candidateText.slice(candidateRange.start, candidateRange.end);
        if (candidateSelection === restoredText) {
            // Ignore edits elsewhere in the document until a selected edit is found.
            selectedRange = candidateRange;
            workingText = candidateText;
            if (historyIndexes.length > 0) {break;}
            continue;
        }

        restoredText = candidateSelection;
        selectedRange = candidateRange;
        workingText = candidateText;
        historyIndexes.push(index);
    }

    return { text: restoredText, historyIndexes };
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
