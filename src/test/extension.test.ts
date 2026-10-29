import * as assert from 'assert';
import * as vscode from 'vscode';
import { handleDocumentClose, handleDocumentOpen } from '../documentLifecycle';

const command = 'selection-undo.undoSelection';
const redoSelectionCommand = 'selection-undo.redoSelection';

suite('Undo Only Selected', () => {
	async function activateExtension() {
		const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'undo-only-selected');
		assert.ok(extension, 'extension should be installed in the test host');
		await extension.activate();
	}

	test('reverts the selected text and preserves later edits elsewhere', async () => {
		await activateExtension();
		const document = await vscode.workspace.openTextDocument({
			language: 'plaintext',
			content: 'original\nkeep me',
		});
		const editor = await vscode.window.showTextDocument(document);

		await editor.edit(edit => {
			edit.replace(document.lineAt(0).range, 'rewritten');
		});
		await editor.edit(edit => {
			edit.replace(document.lineAt(1).range, 'keep me, with a later edit');
		});

		editor.selection = new vscode.Selection(0, 0, 0, document.lineAt(0).text.length);
		await vscode.commands.executeCommand(command);

		assert.strictEqual(document.getText(), 'original\nkeep me, with a later edit');
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: '' }));
	});

	test('reverts a run of typing within the selected text', async () => {
		await activateExtension();
		const document = await vscode.workspace.openTextDocument({
			language: 'plaintext',
			content: '\nuntouched',
		});
		const editor = await vscode.window.showTextDocument(document);

		for (const [index, character] of Array.from('const x = 1;').entries()) {
			await editor.edit(edit => {
				edit.insert(new vscode.Position(0, index), character);
			});
		}

		editor.selection = new vscode.Selection(0, 0, 0, document.lineAt(0).text.length);
		await vscode.commands.executeCommand(command);

		assert.strictEqual(document.getText(), '\nuntouched');
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: '' }));
	});

	test('undoes and redoes only the selected lines', async () => {
		await activateExtension();
		const document = await vscode.workspace.openTextDocument({
			language: 'plaintext',
			content: 'first\nsecond\nuntouched',
		});
		const editor = await vscode.window.showTextDocument(document);

		await editor.edit(edit => {
			edit.replace(new vscode.Range(0, 0, 1, document.lineAt(1).text.length), 'edited first\nedited second');
		});
		editor.selection = new vscode.Selection(0, 0, 1, document.lineAt(1).text.length);
		await vscode.commands.executeCommand(command);
		assert.strictEqual(document.getText(), 'first\nsecond\nuntouched');

		editor.selection = new vscode.Selection(0, 0, 1, document.lineAt(1).text.length);
		await vscode.commands.executeCommand(redoSelectionCommand);
		assert.strictEqual(document.getText(), 'edited first\nedited second\nuntouched');
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: '' }));
	});

	test('clears redo history when a new edit is made', async () => {
		await activateExtension();
		const document = await vscode.workspace.openTextDocument({
			language: 'plaintext',
			content: 'original\nuntouched',
		});
		const editor = await vscode.window.showTextDocument(document);
		await editor.edit(edit => edit.replace(document.lineAt(0).range, 'rewritten'));
		editor.selection = new vscode.Selection(0, 0, 0, document.lineAt(0).text.length);
		await vscode.commands.executeCommand(command);
		assert.strictEqual(document.getText(), 'original\nuntouched');

		await editor.edit(edit => edit.replace(document.lineAt(0).range, 'new edit'));
		editor.selection = new vscode.Selection(0, 0, 0, document.lineAt(0).text.length);
		await vscode.commands.executeCommand(redoSelectionCommand);
		assert.strictEqual(document.getText(), 'new edit\nuntouched');
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: '' }));
	});

	test('preserves history on close and same-content reopen', () => {
		const uri = 'file:///sample.txt';
		const history = new Map([[uri, [{ text: 'original text', groupId: 1 }]]]);
		const redoHistory = new Map([[uri, [{ text: 'redo text', groupId: 2 }]]]);
		const knownText = new Map([[uri, 'edited text']]);
		const pendingHistoryText = new Map([[uri, 'temporary']]);
		const state = { history, redoHistory, knownText, pendingHistoryText };

		handleDocumentClose(uri, state);
		handleDocumentOpen(uri, 'edited text', state);

		assert.deepStrictEqual(history.get(uri), [{ text: 'original text', groupId: 1 }]);
		assert.deepStrictEqual(redoHistory.get(uri), [{ text: 'redo text', groupId: 2 }]);
		assert.strictEqual(knownText.get(uri), 'edited text');
		assert.strictEqual(pendingHistoryText.has(uri), false);
	});

	test('discards closed-document history if its contents changed', () => {
		const uri = 'file:///sample.txt';
		const history = new Map([[uri, [{ text: 'original text', groupId: 1 }]]]);
		const redoHistory = new Map([[uri, [{ text: 'redo text', groupId: 2 }]]]);
		const knownText = new Map([[uri, 'edited text']]);
		const pendingHistoryText = new Map([[uri, 'temporary']]);
		const state = { history, redoHistory, knownText, pendingHistoryText };

		handleDocumentClose(uri, state);
		handleDocumentOpen(uri, 'changed elsewhere', state);

		assert.strictEqual(history.has(uri), false);
		assert.strictEqual(redoHistory.has(uri), false);
		assert.strictEqual(knownText.get(uri), 'changed elsewhere');
		assert.strictEqual(pendingHistoryText.has(uri), false);
	});
});
