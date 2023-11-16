import {
	ExtensionContext,
	window,
	workspace,
	TextDocumentChangeEvent,
} from 'vscode';

import { OutlineView } from './outline';
import { debounce } from '../common';

// called when extension is activated
// extension is activated the very first time the command is executed
export function activate(context: ExtensionContext) {

	const outlineView = new OutlineView(context);

	// add event listeners
	// update outline when document is changed
	window.onDidChangeActiveTextEditor(event => {
		const document = event?.document || window.activeTextEditor?.document;
		if (document) outlineView.update(document);
	});

	// edit
	workspace.onDidChangeTextDocument(debounce((event: TextDocumentChangeEvent) => {
		const document = event.document;
		outlineView.update(document);
	}, 300));

	context.subscriptions.push(
		window.registerWebviewViewProvider('outline-map-view', outlineView),
	);
}

