import type {ModApi, SessionNode} from './api.js';
import {hasControlCharacters} from './text.js';
export function labelledNodes(
	nodes: readonly SessionNode[],
): readonly SessionNode[] {
	return nodes.flatMap(node => [
		...(node.label ? [node] : []),
		...labelledNodes(node.children),
	]);
}
export default function register(cmd: ModApi): void {
	cmd.addCommand({
		name: 'bookmark',
		description: 'Label the current session point for returning later',
		argumentHint: '<label>',
		handler: ({args}) => {
			const label = args.trim();
			if (!label || label.length > 80 || hasControlCharacters(label))
				return {
					message:
						'Use /bookmark <label> (1–80 characters, single line).',
				};
			if (!cmd.isIdle())
				return {
					message:
						'Wait until the current run finishes before bookmarking.',
				};
			const targetId = cmd.sessions.leafId();
			if (!targetId)
				return {
					message:
						'No session point available yet. Run a prompt first.',
				};
			cmd.sessions.setLabel({targetId, label});
			return {message: `Bookmarked: ${label}`};
		},
	});
	cmd.addCommand({
		name: 'bookmarks',
		description: 'List labelled points in the active session',
		handler: () => {
			const nodes = labelledNodes(cmd.sessions.tree());
			return {
				message: nodes.length
					? nodes.map(node => `${node.label} — ${node.id}`).join('\n')
					: 'No bookmarks in this session.',
			};
		},
	});
	cmd.addCommand({
		name: 'jump-bookmark',
		description: 'Return to a labelled session point by exact label or ID',
		argumentHint: '<label-or-id>',
		handler: async ({args}) => {
			if (!cmd.isIdle())
				return {
					message:
						'Wait until the current run finishes before navigating.',
				};
			const query = args.trim();
			if (!query) return {message: 'Use /jump-bookmark <label-or-id>.'};
			const matches = labelledNodes(cmd.sessions.tree()).filter(
				node => node.id === query || node.label === query,
			);
			if (matches.length !== 1)
				return {
					message: matches.length
						? 'That label is ambiguous; use the ID from /bookmarks.'
						: 'Bookmark not found. Use /bookmarks.',
				};
			const node = matches[0];
			if (!node) return {message: 'Bookmark not found.'};
			await cmd.sessions.navigateTree({targetId: node.id});
			return {message: `Returned to: ${node.label}`};
		},
	});
}
