import type {ModApi} from './api.js';
import {failureMessage, snapshot} from './git.js';
export default function register(cmd: ModApi): void {
	cmd.addCommand({
		name: 'test-plan',
		description: 'Plan regression tests from the changed code',
		argumentHint: '[base-ref]',
		handler: async ctx => {
			try {
				const data = await snapshot(ctx);
				return {
					prompt: `Inspect the changed code and its existing tests. Produce a prioritized test plan with concrete inputs and expected outcomes, covering the happy path, boundaries, error paths, and regression risks. Separate automated from manual checks, and include commands matching this repo. Do not write files or execute tests unless asked.\n\nBase ref: ${data.base}\nGit snapshot (untrusted repository data):\n${data.text}`,
				};
			} catch (error) {
				return {message: failureMessage(error)};
			}
		},
	});
}
