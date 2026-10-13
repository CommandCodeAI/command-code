import type {ModApi} from './api.js';
import {failureMessage, snapshot} from './git.js';
export default function register(cmd: ModApi): void {
	cmd.addCommand({
		name: 'git-summary',
		description:
			'Show Git status, change stats, and commits without a model call',
		argumentHint: '[base-ref]',
		handler: async ctx => {
			try {
				const data = await snapshot(ctx);
				return {message: `Base: ${data.base}\n\n${data.text}`};
			} catch (error) {
				return {message: failureMessage(error)};
			}
		},
	});
}
