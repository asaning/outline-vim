import { config } from './config';
import { commands, DocumentSymbol, ExtensionContext, TextDocument, Uri, WebviewView, WebviewViewProvider, window, Range, Selection } from 'vscode';
import { Msg, UpdateMsg, Op, UpdateOp, DeleteOp, InsertOp, SymbolNode, MoveOp } from '../common';

/**
 * Provides the outline view.
 */
export class OutlineView implements WebviewViewProvider {

	/** The webview View of the outline. */
	private view: WebviewView | undefined;

	/** The uri of the directory containing this extension. */
	private extensionUri: Uri;

	private outlineTree: OutlineTree | undefined;

	private focusing: Set<SymbolNode> = new Set();

	private prevSelections: Selection[] = [];

	private inView: Set<SymbolNode> = new Set();

	constructor(context: ExtensionContext) {
		this.extensionUri = context.extensionUri;
	}

	resolveWebviewView(webviewView: WebviewView): void | Thenable<void> {
		this.view = webviewView;

		this.view.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this.extensionUri,
			],
		};

		this.render();
		setTimeout(() => {
			this.build();
		}, 1000);
		this.view.onDidChangeVisibility(() => {
			if (this.view?.visible && window.activeTextEditor) {
				this.build();
			}
			if (!this.view?.visible) {
				this.outlineTree = undefined;
				this.inView.clear();
				this.focusing.clear();
				this.prevSelections = [];
			}
		});
	}

	build() {
		this.update(window.activeTextEditor?.document || window.visibleTextEditors[0].document);
		this.postMessage({
			type: 'config',
			data: {
				color: config.color(),
			},
		});
	}

	/**
	 * Sends a message to the webview.
	 * @param message The message to send to the webview, must contain a type property.
	*/
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	postMessage(message: Msg) {
		this.view?.webview.postMessage(message);
	}

	/**
	 * Focuses the outline on the current selection.
	 */
	focus(selections: readonly Selection[]) {
		if (!this.outlineTree) return;
		// if (this.pinStatus === PinStatus.frozen) return;
		// check if the selection has changed
		const changed =
			selections.length !== this.prevSelections.length ||
			selections.some((selection, i) => {
				return (
					selection.start.line !== this.prevSelections[i].start.line ||
					selection.end.line !== this.prevSelections[i].end.line
				);
			});

		if (!changed) {
			return;
		}
		this.prevSelections = selections.slice();

		const Ops: UpdateOp[] = [];
		// 1. unfocus all nodes
		for (const node of this.focusing) {
			node.focus = false;
		}

		// 2. focus the nodes in the selection
		for (const selection of selections) {

			const { inRange } = this.outlineTree.findNodesIn(selection);

			inRange?.forEach((n) => {
				n.focus = true;
				if (this.focusing.has(n)) {
					return;
				}
				this.focusing.add(n);
			});
		}

		// 3. send the update message && remove the unfocused nodes
		for (const node of this.focusing) {
			Ops.push({
				type: 'update',
				selector: node.selector.join(' >.outline-children> '),
				property: 'focus',
				value: node.focus,
			} as UpdateOp);
			if (!node.focus) {
				this.focusing.delete(node);
			}
		}

		this.postMessage({
			type: 'update',
			data: {
				patches: Ops,
			},
		} as UpdateMsg);
	}

	updateViewPort(range: Range) {
		if (!this.outlineTree) return;
		// if (this.pinStatus === PinStatus.frozen) return;
		const Ops: UpdateOp[] = [];
		// 1. remove all nodes in the viewport
		for (const node of this.inView) {
			node.inView = false;
			node.expand = false;
		}

		// 2. add the nodes in the viewport
		const { inRange, involves } = this.outlineTree.findNodesIn(range);
		inRange.forEach((node) => {
			node.inView = true;
			node.expand = true;
			if (this.inView.has(node)) {
				return;
			}
			this.inView.add(node);
		});

		// 3. send the update message && remove the nodes out of the viewport
		for (const node of this.inView) {
			Ops.push({
				type: 'update',
				selector: node.selector.join(' >.outline-children> '),
				property: 'inview',
				value: node.inView,
			} as UpdateOp);
			if (!node.inView && !node.expand) {
				this.inView.delete(node);
			}
		}

		this.postMessage({
			type: 'update',
			data: {
				patches: Ops,
			},
		} as UpdateMsg);
	}

	/**
	 * Renders the webview.
	 */
	private render() {
		if (!this.view) {
			return;
		}
		const getAssetUri = (path: string) => {
			return this.view?.webview.asWebviewUri(Uri.joinPath(this.extensionUri, ...path.split('/')));
		};

		this.view.webview.html = /*html*/`
			<!DOCTYPE html>
			<html>
			  <head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Outline Map</title>
				<style>
					:not(.codicon) {
						font-family: ${config.customFont() || 'system-ui'}
					}
					${config.customCSS()}
				</style>
				<style id="color-style"></style>
			  </head>
			  <body>
				<script type="module" src="${getAssetUri('out/webview/index.js')}"></script>
			  </body>
			</html>`;
	}

	update(textDocument: TextDocument) {
		const newOutlineTree = new OutlineTree(textDocument);
		newOutlineTree.updateSymbols().then(() => {
			const patcher = new Patcher([], newOutlineTree.getNodes());
			const ops = patcher.getOps();
			this.postMessage({
				type: 'update',
				data: {
					patches: ops,
				},
			} as UpdateMsg);
			this.outlineTree = newOutlineTree;
		});
	}

}

/**
 * Provides the outline tree.
 * 
 */
class OutlineTree {

	private textDocument: TextDocument;

	private nodes: SymbolNode[] = [];

	/** The maximum number of times to try to update the symbols before giving up. */
	private readonly MAX_ATTEMPTS = 10;

	/** Times has tried to update the symbols. */
	private attempts = 0;

	constructor(textDocument: TextDocument) {
		this.textDocument = textDocument;
	}

	getNodes() {
		return this.nodes;
	}

	/**
	 * Gets the outline tree.
	 */
	async updateSymbols() {
		const docSymbols = await commands.executeCommand<DocumentSymbol[]>(
			'vscode.executeDocumentSymbolProvider',
			this.textDocument.uri,
		);

		if (docSymbols) {
			this.nodes = SymbolNode.fromDocumentSymbols(docSymbols);
			// Reset attempts
			this.attempts = 0;
		} else if (this.attempts < this.MAX_ATTEMPTS) {
			// Sometimes the symbol provider is not loaded yet when the command is executed
			// So we try again a few times
			// See https://github.com/microsoft/vscode/issues/169566
			this.attempts++;
			// Try again in 300ms
			setTimeout(() => this.updateSymbols(), 300);
			console.log(`Outline-map: Failed to get symbols of ${this.textDocument.uri.toString()}. Attempt ${this.attempts} of ${this.MAX_ATTEMPTS}.`);
		} else {
			throw new Error(`Outline-map: Failed to get symbols of ${this.textDocument.uri.toString()}.`);
		}
	}

	/**
	 * Finds the nodes in the given range.
	 * 
	 * if the range contains the start of a node, the node will be included.
	 * if the range does not contain any node, the node that contains the range will be included.
	 */
	findNodesIn(range: Range): {
		inRange: SymbolNode[],
		involves: SymbolNode[],
	} {
		const nodesInRange: SymbolNode[] = [];
		const nodesInvolved: SymbolNode[] = [];

		(function find(nodes: SymbolNode[]) {
			let found = false;
			nodes.forEach(node => {
				const anchor = node.range.start.line;
				const end = node.range.end.line;
				const rs = range.start.line;
				const re = range.end.line;
				if (re >= anchor && rs <= anchor) {
					// the anchor is in the range
					nodesInRange.push(node);
					found = true;
				}
				if (anchor <= re && end >= rs && node.children) {
					// the range and the node overlap
					const foundInChildren = find(node.children);
					found = found || foundInChildren;
					nodesInvolved.push(node);
				}
				if (re <= end && rs >= anchor && !found) {
					// the end is in the range
					nodesInRange.push(node);
					found = true;
				}
			});
			return found;
		})(this.nodes);

		return {
			inRange: nodesInRange,
			involves: nodesInvolved,
		};
	}
}

class Patcher {

	private oldNode: SymbolNode[];

	private newNode: SymbolNode[];

	private ops: Op[] = [];

	constructor(oldNode: SymbolNode[], newNode: SymbolNode[]) {
		this.oldNode = oldNode;
		this.newNode = newNode;
		this.patch();
	}

	getOps() {
		return this.ops;
	}

	private patch() {
		this.updateChildren(this.oldNode, this.newNode, ['#outline-root']);
	}

	/**
	 * Checks if two nodes are the same (they have the same name and kind).
	 */
	private sameNode(a: SymbolNode, b: SymbolNode) {
		return a.name === b.name && a.kind === b.kind;
	}

	/**
	 * Update the properties of the **same node**
	 */
	private patchNode(oldNode: SymbolNode, newNode: SymbolNode, selector: string[]) {
		// update properties except `name`, `kind` & `children`	
		const exclude = ['name', 'kind', 'children'];
		const properties = Object.keys(oldNode).filter(key => !exclude.includes(key));
		const selectorStr = selector.concat(`[data-key="${newNode.kind}-${newNode.name}"]`).join(' >.outline-children> ');
		for (const property of properties) {
			const oldValue = Object.getOwnPropertyDescriptor(oldNode, property)?.value;
			const newValue = Object.getOwnPropertyDescriptor(newNode, property)?.value;
			if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
				this.ops.push({
					selector: selectorStr,
					type: 'update',
					property,
					value: typeof newValue === 'object' ? JSON.stringify(newValue) : newValue,
				} as UpdateOp);
			}
		}

		const oldHasChildren = oldNode.children && oldNode.children.length > 0;
		const newHasChildren = newNode.children && newNode.children.length > 0;
		// if both oldNode and newNode have children
		if (oldHasChildren && newHasChildren) {
			this.updateChildren(
				oldNode.children,
				newNode.children,
				selector.concat(`[data-key="${newNode.kind}-${newNode.name}"]`)
			);
		}
		// if oldNode has children but newNode doesn't
		else if (oldHasChildren && !newHasChildren) {
			this.ops.push({
				selector: selectorStr,
				type: 'delete',
				nodes: oldNode.children,
			} as DeleteOp);
		}
		// if newNode has children but oldNode doesn't
		else if (!oldHasChildren && newHasChildren) {
			this.ops.push({
				selector: selectorStr,
				type: 'insert',
				before: null,
				nodes: newNode.children,
			} as InsertOp);
		}
	}

	/**
	 * Update the children of the **same node**
	 * https://juejin.cn/post/7000266544181674014#heading-28
	 * https://github.com/snabbdom/snabbdom/blob/230aa23a694726921c405c4b353e8cb6968483bb/src/init.ts
	 */
	private updateChildren(oldChildren: SymbolNode[], newChildren: SymbolNode[], selector: string[]) {
		let oldStartIdx = 0;
		let newStartIdx = 0;
		let oldEndIdx = oldChildren.length - 1;
		let newEndIdx = newChildren.length - 1;
		let oldStartNode = oldChildren[oldStartIdx];
		let newStartNode = newChildren[newStartIdx];
		let oldEndNode = oldChildren[oldEndIdx];
		let newEndNode = newChildren[newEndIdx];
		const selectorStr = selector.join(' >.outline-children> ');

		while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
			if (this.sameNode(oldStartNode, newStartNode)) {
				// update properties
				this.patchNode(oldStartNode, newStartNode, selector);
				oldStartNode = oldChildren[++oldStartIdx];
				newStartNode = newChildren[++newStartIdx];
			} else if (this.sameNode(oldEndNode, newEndNode)) {
				// update properties
				this.patchNode(oldEndNode, newEndNode, selector);
				oldEndNode = oldChildren[--oldEndIdx];
				newEndNode = newChildren[--newEndIdx];
			} else if (this.sameNode(oldStartNode, newEndNode)) {
				// update properties and move to the end
				this.patchNode(oldStartNode, newEndNode, selector);
				this.ops.push({
					selector: selectorStr,
					type: 'move',
					nodes: [oldStartNode],
					before: oldChildren[oldEndIdx + 1] || null
				} as MoveOp);
				oldStartNode = oldChildren[++oldStartIdx];
				newEndNode = newChildren[--newEndIdx];
			} else if (this.sameNode(oldEndNode, newStartNode)) {
				// update properties and move to the start
				this.patchNode(oldEndNode, newStartNode, selector);
				this.ops.push({
					selector: selectorStr,
					type: 'move',
					nodes: [oldEndNode],
					before: oldChildren[oldStartIdx] || null
				} as MoveOp);
				oldEndNode = oldChildren[--oldEndIdx];
				newStartNode = newChildren[++newStartIdx];
			} else {
				// find the index of the newStartNode in the oldChildren
				const idx = oldChildren.findIndex(node => this.sameNode(node, newStartNode));
				if (idx >= 0) {
					this.patchNode(oldChildren[idx], newStartNode, selector);
					this.ops.push({
						selector: selectorStr,
						type: 'move',
						nodes: [oldChildren[idx]],
						before: oldChildren[oldStartIdx] || null
					} as MoveOp);
					oldChildren.splice(idx, 1);
				} else {
					this.ops.push({
						selector: selectorStr,
						type: 'insert',
						nodes: [newStartNode],
						before: oldChildren[oldStartIdx],
					} as InsertOp);
					newStartIdx++;
					break;
				}
			}

		}

		if (oldStartIdx <= oldEndIdx) {
			this.ops.push({
				selector: selectorStr,
				type: 'delete',
				nodes: oldChildren.slice(oldStartIdx, oldEndIdx + 1),
			} as DeleteOp);
		}

		if (newStartIdx <= newEndIdx) {
			this.ops.push({
				selector: selectorStr,
				type: 'insert',
				nodes: newChildren.slice(newStartIdx, newEndIdx + 1),
				before: oldChildren[oldStartIdx] || null,
			} as InsertOp);
		}
	}
}