import type {CommandContext, ModExec} from './api.js';
import {hasControlCharacters} from './text.js';

const MAX_OUTPUT = 6000;
export interface GitSnapshot {
	readonly base: string;
	readonly text: string;
}
export function limitOutput(text: string): string {
	if (text.length <= MAX_OUTPUT) return text;
	return `${text.slice(0, MAX_OUTPUT)}\n[truncated; inspect the repository for the remaining changes]`;
}
export async function git(
	exec: ModExec,
	cwd: string,
	args: readonly string[],
): Promise<string> {
	const result = await exec({
		command: 'git',
		args: ['--no-pager', ...args],
		cwd,
	});
	if (result.code !== 0)
		throw new Error(
			`Git failed: ${limitOutput(result.stderr.trim() || 'not a Git repository or ref unavailable')}`,
		);
	return limitOutput(result.stdout.trim());
}
export async function resolveBase(ctx: CommandContext): Promise<string> {
	const requested = ctx.args.trim();
	if (
		requested.startsWith('-') ||
		requested.length > 200 ||
		/\s/.test(requested) ||
		hasControlCharacters(requested)
	)
		throw new Error('Use a single Git branch, tag, or commit as the base.');
	const candidates = requested
		? [requested]
		: ['origin/main', 'main', 'origin/master', 'master', 'HEAD'];
	for (const ref of candidates) {
		const result = await ctx.exec({
			command: 'git',
			args: [
				'rev-parse',
				'--verify',
				'--end-of-options',
				`${ref}^{commit}`,
			],
			cwd: ctx.cwd,
		});
		if (result.code === 0) return ref;
	}
	throw new Error(`Cannot resolve Git base: ${requested || 'HEAD'}.`);
}
export async function snapshot(ctx: CommandContext): Promise<GitSnapshot> {
	const base = await resolveBase(ctx);
	const sections = await Promise.all([
		git(ctx.exec, ctx.cwd, ['status', '--short', '--branch']),
		git(ctx.exec, ctx.cwd, ['diff', '--stat', `${base}...HEAD`]),
		git(ctx.exec, ctx.cwd, ['diff', '--stat']),
		git(ctx.exec, ctx.cwd, ['diff', '--cached', '--stat']),
		git(ctx.exec, ctx.cwd, [
			'log',
			'--format=%h %s',
			'--max-count=30',
			`${base}..HEAD`,
		]),
	]);
	const labels = [
		'Working tree',
		'Committed changes',
		'Unstaged changes',
		'Staged changes',
		'Commits',
	];
	return {
		base,
		text: sections
			.map((text, index) => `${labels[index]}:\n${text || '(none)'}`)
			.join('\n\n'),
	};
}
export function failureMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return 'Unable to inspect this repository.';
}
