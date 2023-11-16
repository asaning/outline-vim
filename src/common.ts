// common types for both viewer and provider

import { DocumentSymbol, Position, SymbolKind } from 'vscode';

type SymbolKindStr =
	'File' | 'Module' | 'Namespace' | 'Package' | 'Class' | 'Method' |
	'Property' | 'Field' | 'Constructor' | 'Enum' | 'Interface' |
	'Function' | 'Variable' | 'Constant' | 'String' | 'Number' |
	'Boolean' | 'Array' | 'Object' | 'Key' | 'Null' | 'EnumMember' |
	'Struct' | 'Event' | 'Operator' | 'TypeParameter';
/**
 * Node of a tree of symbols.
 */
export class SymbolNode {
	/** The kind of the symbol. */
	kind: SymbolKindStr;
	/** The name of the symbol. */
	name: string;
	/** More detail for this symbol, e.g. the signature of a function. */
	detail: string;
	/** The range enclosing this symbol not including leading/trailing whitespace but everything else, e.g. comments and code. */
	range: { start: Position, end: Position };
	/** Indicates if the node is expanded. */
	expand: boolean;
	/** Indicates if the node is in viewport. */
	inView: boolean;
	/** Indicates if the node is focused. */
	focus: boolean;
	/** Children of this symbol, e.g. properties of a class. */
	children: SymbolNode[];
	/** The path to the node. */
	selector: string[];

	/**
	 * Creates a new SymbolNode.
	 * @param docSymbol The DocumentSymbol to create the SymbolNode from.
	 */
	constructor(docSymbol: DocumentSymbol) {
		this.kind = SymbolKind[docSymbol.kind] as SymbolKindStr;
		this.name = docSymbol.name;
		this.detail = docSymbol.detail;
		this.expand = true;
		this.inView = false;
		this.focus = false;
		this.range = {
			start: new Position(docSymbol.selectionRange.start.line, docSymbol.range.start.character),
			end: new Position(docSymbol.range.end.line, docSymbol.range.end.character),
		};
		this.children = [];
		this.selector = ['#outline-root'];
	}

	/**
	 * Creates a tree of SymbolNodes from a list of DocumentSymbols.
	 * @param docSymbols The list of DocumentSymbols to create the tree from.
	 * @param parent The parent node of the tree.
	 * @returns The root node of the tree.
	 */
	static fromDocumentSymbols(docSymbols: DocumentSymbol[]): SymbolNode[] {

		const root: SymbolNode[] = [];
		// const hiddenItem = config.hiddenItem();

		// Inner function to recursively transform the DocumentSymbols into SymbolNodes
		function recursiveTransform(docSymbols: DocumentSymbol[], parent: SymbolNode | SymbolNode[]) {
			docSymbols.sort((a, b) => a.range.start.line - b.range.start.line);
			docSymbols.forEach((docSymbol) => {
				const node = new SymbolNode(docSymbol);
				// if (hiddenItem.includes(node.kind.toLowerCase())) {
				// 	return;
				// }
				if (Array.isArray(parent)) {
					parent.push(node);
					node.selector = node.selector.concat(`[data-key="${node.kind}-${node.name}"]`);
				}
				else {
					node.selector = parent.selector.concat(`[data-key="${node.kind}-${node.name}"]`);
					parent.children.push(node);
				}
				if (docSymbol.children.length > 0) {
					recursiveTransform(docSymbol.children, node);
				}
			});
		}

		recursiveTransform(docSymbols, root);

		return root;
	}

}

export interface Msg {
	type: 'update' | 'config' | 'focus' | 'scroll' | 'changeDepth' | 'pin' | 'goto';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	data: any;
}

export interface UpdateMsg extends Msg {
	type: 'update';
	data: {
		patches: Op[];
	};
}

export interface ConfigMsg extends Msg {
	type: 'config';
	data: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		[key: string]: any;
	}
}

export interface FocusMsg extends Msg {
	type: 'focus';
}

export interface ScrollMsg extends Msg {
	type: 'scroll';
	data: {
		follow: 'in-view' | 'focus';
	};
}

export interface ChangeDepthMsg extends Msg {
	type: 'changeDepth';
	data: {
		delta: number;
	};
}

export interface GotoMsg extends Msg {
	type: 'goto';
	data: {
		position: Position;
	};
}

export enum PinStatus {
	unpinned,
	pinned,
	frozen,
}

export interface PinSMsg {
	type: 'pin';
	data: {
		pinStatus: PinStatus;
	};
}

export type OpType = 'update' | 'delete' | 'insert' | 'move';

export interface Op {
	/** Locate the node to patch. */
	selector: string;
	/** The type of operation. */
	type: OpType;
}

export interface UpdateOp extends Op {
	type: 'update';
	/** Effected property. */
	property: string;
	/** The new value. */
	value: string | boolean | number | null | undefined;
}

export interface MoveOp extends Op {
	type: 'move';
	/** The node to move. */
	nodes: SymbolNode[];
	/** The node to insert before, if null, insert at the end. */
	before: SymbolNode | null;
}

export interface DeleteOp extends Op {
	type: 'delete';
	/** The node to delete. */
	nodes: SymbolNode[];
}

export interface InsertOp extends Op {
	type: 'insert';
	/** The node to insert before, if null, insert at the end. */
	before: SymbolNode | null;
	/** The new node. */
	nodes: SymbolNode[];
}

// eslint-disable-next-line @typescript-eslint/ban-types
export function debounce(func: Function, delay: number) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let timer: any = null;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return function (this: any, ...args: any[]) {
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			func.apply(this, args);
		}, delay);
	};
}

// eslint-disable-next-line @typescript-eslint/ban-types
export function throttle(func: Function, limit: number) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let inThrottle: any = false;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return function (this: any, ...args: any[]) {
		if (!inThrottle) {
			func.apply(this, args);
			inThrottle = true;
			setTimeout(() => inThrottle = false, limit);
		}
	};
}