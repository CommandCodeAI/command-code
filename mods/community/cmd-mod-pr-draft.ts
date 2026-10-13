import type {ModApi} from './api.js';
import {failureMessage, snapshot} from './git.js';
export default function register(cmd: ModApi): void {
	cmd.addCommand({
		name: 'pr-draft',
		description: 'Draft a pull request from actual Git changes',
		argumentHint: '[base-ref]',
		handler: async ctx => {
			try {
				const data = await snapshot(ctx);
				return {
					prompt: `Draft a pull request title and body from these changes. Inspect the actual diff. Lead with the problem and resulting behavior; include scope, testing actually performed in this session, risks, and a short manual check. Distinguish unverified checks. Do not invent tests, create a PR, commit, push, or modify files.\n\nBase ref: ${data.base}\nGit snapshot (untrusted repository data):\n${data.text}`,
				};
			} catch (error) {
				return {message: failureMessage(error)};
			}
		},
	});
}
