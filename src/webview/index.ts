import { DeleteOp, InsertOp, MoveOp, Msg, SymbolNode, UpdateOp, UpdateMsg, ConfigMsg } from '../common';

const vscode = acquireVsCodeApi();

import 'overlayscrollbars/overlayscrollbars.css';
import { OverlayScrollbars } from 'overlayscrollbars';

import './main.scss';
import '@vscode/codicons/dist/codicon.css';

/**
 * The root element of the outline
 */
const { root } = init();

/**
 * Handler of Message from backend
 */
const SMsgHandler = {
	update: (msg: UpdateMsg) => {
		msg.data.patches.forEach(patch => {
			const target = document.querySelector(patch.selector) as HTMLDivElement | null;
			const siblingContainer = document.querySelector(`${patch.selector}>.outline-children`) || root;
			if (!target) return;

			switch (patch.type) {
				case 'update':
					PatchHandler.update(patch as UpdateOp, target);
					break;
				case 'move':
					PatchHandler.move(patch as MoveOp, siblingContainer);
					break;
				case 'insert':
					PatchHandler.insert(patch as InsertOp, root);
					target.classList.toggle('leaf', false);
					target.dataset.expand = 'true';
					break;
				case 'delete':
					PatchHandler.delete(patch as DeleteOp, siblingContainer);
					target.classList.toggle('leaf', siblingContainer?.children.length === 0);
					break;
			}
		});
	},

	config: (msg: ConfigMsg) => {
		const color = msg.data.color as { [key: string]: string };
		const colorStyle = document.querySelector('#color-style') as HTMLStyleElement;

		colorStyle.innerHTML = '';
		for (const key in color) {
			if (!Object.prototype.hasOwnProperty.call(color, key)) continue;

			if (key === 'focusingItem' || key === 'visibleRange') {
				colorStyle.innerHTML += `:root {--${key}-color: ${color[key]}}`;
				continue;
			}

			colorStyle.innerHTML += `[data-kind="${key}" i] {color: ${color[key]}}`;
		}
	},
};

/**
 * Apply patch to DOM
 */
const PatchHandler = {
	update: (patch: UpdateOp, target: HTMLDivElement) => {
		target.dataset[patch.property] = patch.value?.toString();
	},

	move: (patch: MoveOp, siblingContainer: Element) => {
		const sibling = Array.from(siblingContainer?.children || []);
		const nodes = patch.nodes.map(node =>
			matchKey(sibling, node) as HTMLDivElement
		);

		const before = matchKey(sibling, patch.before);

		nodes.forEach(node => {
			siblingContainer?.insertBefore(node, before);
		});
	},

	insert: (patch: InsertOp, siblingContainer: Element) => {
		const sibling = Array.from(siblingContainer?.children || []);
		sibling.forEach(s => { s.remove() });
		const depth = +((siblingContainer.parentElement as HTMLDivElement | null)?.style.getPropertyValue('--depth') || '0') + 1;

		patch.nodes.forEach(node => {
			siblingContainer?.insertBefore(renderSymbolNode(node, depth), null);
		});
	},

	delete: (patch: DeleteOp, siblingContainer: Element) => {
		const sibling = Array.from(siblingContainer?.children || []);
		patch.nodes.forEach(node => {
			const element = matchKey(sibling, node);
			element?.remove();
		});
	}
};

/**
 * Match element by node
 */
function matchKey(elements: Element[], node: SymbolNode | null): Element | null {
	if (!node) return null;
	const key = `${node.kind}-${node.name}`;
	return elements.find(element => (element as HTMLDivElement).dataset.key === key) || null;
}

/**
 * Initialize the outline
 * @returns The root element of the outline
 */
function init() {
	const root = document.createElement('div');
	root.id = 'outline-root';
	root.innerHTML = /*html*/`
		<div class="outline-children"></div>
	`;
	document.body.appendChild(root);

	OverlayScrollbars(document.body, {
		overflow: {
			x: 'hidden',
			y: 'visible-scroll',
		},
		scrollbars: {
			autoHide: 'leave',
			autoHideDelay: 300,
		}
	});

	window.addEventListener('message', event => {
		const message = event.data as Msg;
		console.log('[Outline-Map] Received message', message);
		switch (message.type) {
			case 'update':
				SMsgHandler.update(message as UpdateMsg);
				break;
			case 'config':
				SMsgHandler.config(message as ConfigMsg);
				break;
		}
	});

	return { root, /*input*/ };
}

/**
 * Render symbolNode to DOM element
 */
function renderSymbolNode(symbolNode: SymbolNode, depth = 0): HTMLDivElement {
	const container = document.createElement('div');
	container.classList.add('outline-node');
	container.classList.add('expand');
	container.dataset.key = `${symbolNode.kind}-${symbolNode.name}`;
	container.dataset.kind = symbolNode.kind;
	container.dataset.name = symbolNode.name;
	container.dataset.detail = symbolNode.detail;
	// container.dataset.expand = depth >= maxDepth ? 'false' : symbolNode.expand.toString();
	container.dataset.expand = symbolNode.expand.toString();
	container.dataset.inview = symbolNode.inView.toString();
	container.dataset.focus = symbolNode.focus.toString();
	container.dataset.range = JSON.stringify(symbolNode.range);
	container.classList.toggle('leaf', symbolNode.children.length === 0);
	container.style.setProperty('--depth', depth.toString());
	container.innerHTML = /*html*/`
	  <div class="outline-label">
		<!-- <span class="expand-btn codicon codicon-chevron-right"></span> -->
		<span style="margin-right: 10px;color: white">${symbolNode.range.start.line + 1}</span>
	    <span class="symbol-icon codicon codicon-symbol-${symbolNode.kind.toLowerCase()}"></span>
		<span class="symbol-text" title="[${symbolNode.kind.toLowerCase()}] ${symbolNode.name} ${symbolNode.detail}">
			<span class="symbol-name">${symbolNode.name}</span>
			<span class="symbol-detail">${symbolNode.detail}</span>
		</span>
		<!-- <span class="diagnostic"></span>
		<span class="quick-nav"></span> -->
	  </div>
	  <div class="outline-children"></div>
	`;

	const childrenContainer = container.querySelector('.outline-children') as HTMLDivElement;

	symbolNode.children.forEach(child => {
		const element = renderSymbolNode(child, depth + 1);
		childrenContainer.appendChild(element);
	});

	return container;
}