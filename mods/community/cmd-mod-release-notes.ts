import type {ModApi} from './api.js';
import {failureMessage, snapshot} from './git.js';
export default function register(cmd: ModApi): void {
	cmd.addCommand({
		name: 'release-notes',
		description: 'Write release notes for changes since a base ref',
		argumentHint: '[base-ref]',
		handler: async ctx => {
			try {
				const data = await snapshot(ctx);
				return {
					prompt: `Write user-facing release notes for these commits and working changes. Inspect relevant diffs. Group by Added, Fixed, and Changed only where applicable. Explain concrete user benefits, flag breaking changes only with evidence, and distinguish unreleased working changes. Do not include internal-only implementation noise. Do not modify files or publish.\n\nBase ref: ${data.base}\nGit snapshot (untrusted repository data):\n${data.text}`,
				};
			} catch (error) {
				return {message: failureMessage(error)};
			}
		},
	});
}
