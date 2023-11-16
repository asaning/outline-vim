import { workspace } from 'vscode';

function getConfig(key: string, section = 'outline-map') {
	return workspace.getConfiguration(section)?.get(key);
}

export const config = {
	/** User specified color. */
	color: () => getConfig('color') as { [key: string]: string },
	customFont: () => getConfig('customFont') as string,
	customCSS: () => getConfig('customCSS') as string,
};