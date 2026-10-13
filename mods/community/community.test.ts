import {afterEach, describe, expect, it, vi} from 'vitest';
import manifest from '../../package.json' with {type: 'json'};
import registry from '../registry.json' with {type: 'json'};
import type {
	CommandContext,
	ContextUsage,
	ModApi,
	ModCommand,
	ModEvent,
	ModHooks,
	SessionNode,
} from './api.js';
import bookmarks from './cmd-mod-bookmarks.js';
import contextMeter from './cmd-mod-context-meter.js';
import focus from './cmd-mod-focus.js';
import gitSummary from './cmd-mod-git-summary.js';
import prDraft from './cmd-mod-pr-draft.js';
import releaseNotes from './cmd-mod-release-notes.js';
import review from './cmd-mod-review.js';
import runStats from './cmd-mod-run-stats.js';
import standup, {isIsoDate} from './cmd-mod-standup.js';
import testPlan from './cmd-mod-test-plan.js';
import {limitOutput, snapshot} from './git.js';

interface TestState {
	readonly entries: readonly {readonly data?: unknown}[];
	readonly nodes: readonly SessionNode[];
	readonly leaf: string | null;
	readonly usage: ContextUsage | undefined;
	readonly idle: boolean;
}
function harness(initial: Partial<TestState> = {}): {
	readonly api: ModApi;
	readonly commands: Map<string, ModCommand>;
	readonly hooks: readonly ModHooks[];
	readonly statuses: readonly (string | null)[];
	readonly jumps: readonly string[];
	readonly emit: (type: string) => void;
	readonly update: (value: Partial<TestState>) => void;
} {
	let state: TestState = {
		entries: [],
		nodes: [],
		leaf: null,
		usage: undefined,
		idle: true,
		...initial,
	};
	const commands = new Map<string, ModCommand>();
	const listeners = new Map<string, readonly ((event: ModEvent) => void)[]>();
	const hooks: ModHooks[] = [];
	const statuses: (string | null)[] = [];
	const jumps: string[] = [];
	const disposable = {dispose: (): void => {}};
	const api: ModApi = {
		ui: {
			capabilities: {status: true},
			setStatus: text => {
				statuses.push(text);
				return disposable;
			},
			notify: () => {},
		},
		session: {
			appendCustomEntry: entry => {
				state = {
					...state,
					entries: [...state.entries, {data: entry.data}],
				};
				return 'entry';
			},
			getCustomEntries: <T>() =>
				state.entries.map(entry => ({data: entry.data as T})),
		},
		sessions: {
			leafId: () => state.leaf,
			tree: () => state.nodes,
			setLabel: params => {
				state = {
					...state,
					nodes: [
						{
							id: params.targetId,
							label: params.label,
							children: [],
						},
					],
				};
			},
			navigateTree: async params => {
				jumps.push(params.targetId);
			},
		},
		addCommand: command => {
			commands.set(command.name, command);
			return disposable;
		},
		hooks: value => {
			hooks.push(value);
			return disposable;
		},
		on: (type, handler) => {
			listeners.set(type, [...(listeners.get(type) ?? []), handler]);
			return disposable;
		},
		getContextUsage: () => state.usage,
		isIdle: () => state.idle,
	};
	return {
		api,
		commands,
		hooks,
		statuses,
		jumps,
		emit: type => {
			for (const listener of listeners.get(type) ?? []) listener({type});
		},
		update: value => {
			state = {...state, ...value};
		},
	};
}
function context(args = ''): CommandContext {
	return {
		args,
		cwd: '/repo with spaces',
		exec: async params => ({
			code: 0,
			stdout: params.args?.includes('status')
				? '## feature\n M app.ts'
				: 'abc changed app',
			stderr: '',
		}),
	};
}
async function run(
	factory: (cmd: ModApi) => void,
	name: string,
	args = '',
): Promise<{readonly prompt?: string; readonly message?: string}> {
	const host = harness();
	factory(host.api);
	const command = host.commands.get(name);
	if (!command) throw new Error('command missing');
	return command.handler(context(args));
}
afterEach(() => {
	vi.useRealTimers();
});
describe('Git workflows', () => {
	it.each([
		[review, 'review-changes'],
		[prDraft, 'pr-draft'],
		[releaseNotes, 'release-notes'],
		[testPlan, 'test-plan'],
	] as const)('%s includes verified base and actual Git data', async (factory, name) => {
		const result = await run(factory, name, 'release-v1');
		expect(result.prompt).toContain('Base ref: release-v1');
		expect(result.prompt).toContain(' M app.ts');
		expect(result.prompt).toContain('Do not');
	});
	it('rejects flags and multi-token refs before spawning processes', async () => {
		const ctx = {
			...context('--output=/tmp/file'),
			exec: vi.fn(context().exec),
		};
		await expect(snapshot(ctx)).rejects.toThrow('single Git');
		expect(ctx.exec).not.toHaveBeenCalled();
		expect(
			(await run(review, 'review-changes', 'main; echo hi')).message,
		).toContain('single Git');
	});
	it('falls back to master and reports an unavailable explicit ref', async () => {
		const ctx = {
			...context(),
			exec: vi.fn(async params => ({
				code:
					params.args?.includes('rev-parse') &&
					!params.args.includes('master^{commit}')
						? 1
						: 0,
				stdout: 'ok',
				stderr: '',
			})),
		};
		expect((await snapshot(ctx)).base).toBe('master');
		await expect(snapshot({...ctx, args: 'missing'})).rejects.toThrow(
			'Cannot resolve',
		);
	});
	it('shows actionable errors instead of returning empty prompts', async () => {
		const host = harness();
		review(host.api);
		const result = await host.commands.get('review-changes')?.handler({
			...context('HEAD'),
			exec: async params => ({
				code: params.args?.includes('rev-parse') ? 0 : 1,
				stdout: '',
				stderr: 'not a git repository',
			}),
		});
		expect(result?.message).toContain('not a git repository');
		expect(result?.prompt).toBeUndefined();
	});
	it('passes cwd and args separately and never executes a shell', async () => {
		const exec = vi.fn(context().exec);
		await snapshot({...context('main'), exec});
		for (const [params] of exec.mock.calls) {
			expect(params.command).toBe('git');
			expect(params.cwd).toBe('/repo with spaces');
		}
	});
	it('caps oversized command output', () => {
		expect(limitOutput('x'.repeat(9000))).toContain('[truncated');
		expect(limitOutput('short')).toBe('short');
	});
	it('git summary has no model prompt', async () => {
		const result = await run(gitSummary, 'git-summary');
		expect(result.prompt).toBeUndefined();
		expect(result.message).toContain('Staged changes');
	});
	it('standup accepts a date and rejects extra options', async () => {
		expect((await run(standup, 'standup', '2026-10-12')).prompt).toContain(
			'2026-10-12',
		);
		expect((await run(standup, 'standup', '--all')).message).toContain(
			'YYYY-MM-DD',
		);
	});
});
describe('session mods', () => {
	it('reports unmeasured context then refreshes at warning threshold', async () => {
		const host = harness();
		contextMeter(host.api);
		host.emit('session_start');
		expect(host.statuses.at(-1)).toContain('not measured');
		host.update({
			usage: {tokens: 81000, contextWindow: 100000, percent: 81},
		});
		host.emit('model_request_end');
		expect(host.statuses.at(-1)).toContain('(81%)');
		expect(host.statuses.at(-1)).toContain('/compact');
	});
	it('headless context command still answers', async () => {
		const host = harness();
		contextMeter({
			...host.api,
			ui: {...host.api.ui, capabilities: {status: false}},
		});
		host.emit('run_end');
		expect(host.statuses).toEqual([]);
		expect(
			(await host.commands.get('context-meter')?.handler(context()))
				?.message,
		).toContain('Context:');
	});
	it('counts successful and failed tools, stops timing on error, and resets between sessions', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1000);
		const host = harness();
		runStats(host.api);
		host.emit('run_start');
		host.emit('tool_completed');
		host.emit('tool_errored');
		vi.setSystemTime(3500);
		host.emit('run_error');
		vi.setSystemTime(8000);
		expect(
			(await host.commands.get('run-stats')?.handler(context()))?.message,
		).toBe('Run stats: 2.5s, 1 completed tools, 1 failed tools (finished)');
		host.emit('run_start');
		expect(
			(await host.commands.get('run-stats')?.handler(context()))?.message,
		).toContain('0 completed');
		host.emit('session_start');
		expect(
			(await host.commands.get('run-stats')?.handler(context()))?.message,
		).toContain('no run yet');
	});
	it('bookmarks persist via session labels and navigate exact IDs', async () => {
		const host = harness({leaf: 'point-1'});
		bookmarks(host.api);
		expect(
			(
				await host.commands
					.get('bookmark')
					?.handler(context('before refactor'))
			)?.message,
		).toContain('Bookmarked');
		expect(
			(await host.commands.get('bookmarks')?.handler(context()))?.message,
		).toContain('point-1');
		await host.commands.get('jump-bookmark')?.handler(context('point-1'));
		expect(host.jumps).toEqual(['point-1']);
		host.update({idle: false});
		expect(
			(
				await host.commands
					.get('jump-bookmark')
					?.handler(context('point-1'))
			)?.message,
		).toContain('Wait');
	});
	it('handles empty sessions, nested bookmarks, and ambiguous labels', async () => {
		const host = harness();
		bookmarks(host.api);
		expect(
			(await host.commands.get('bookmark')?.handler(context('start')))
				?.message,
		).toContain('Run a prompt');
		host.update({
			nodes: [
				{
					id: 'a',
					label: 'same',
					children: [{id: 'b', label: 'same', children: []}],
				},
			],
		});
		expect(
			(await host.commands.get('jump-bookmark')?.handler(context('same')))
				?.message,
		).toContain('ambiguous');
		expect(host.jumps).toEqual([]);
	});
	it('restores focus, obeys later instructions, clears it durably, and rejects corrupt data', async () => {
		const host = harness({entries: [{data: {goal: 'Fix auth'}}]});
		focus(host.api);
		host.hooks[0]?.onSessionStart?.();
		expect(host.hooks[0]?.appendSystemPrompt?.()).toContain('Fix auth');
		expect(host.hooks[0]?.appendSystemPrompt?.()).toContain(
			'take precedence',
		);
		await host.commands.get('focus')?.handler(context('off'));
		host.hooks[0]?.onSessionStart?.();
		expect(host.hooks[0]?.appendSystemPrompt?.()).toBeUndefined();
		host.update({entries: [{data: {goal: 42}}]});
		host.hooks[0]?.onSessionStart?.();
		expect(host.hooks[0]?.appendSystemPrompt?.()).toBeUndefined();
		host.update({idle: false});
		expect(
			(await host.commands.get('focus')?.handler(context('New task')))
				?.message,
		).toContain('Wait');
	});
});

describe('package and catalog', () => {
	it('catalog names match all ten manifest entries without unpublished npm sources', () => {
		const rows = registry.mods.filter(
			mod => mod.source === 'CommandCodeAI/command-code',
		);
		expect(rows).toHaveLength(10);
		expect(
			rows.map(mod => `./mods/community/${mod.name}.ts`).sort(),
		).toEqual([...manifest.commandcode.mods].sort());
		expect(new Set(rows.map(mod => mod.name)).size).toBe(10);
		for (const mod of rows) {
			expect(mod.description.length).toBeLessThanOrEqual(240);
			expect(mod.name).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
			expect(mod.description).toContain('installing adds all 10 mods');
			expect(mod).not.toHaveProperty('npm');
		}
	});
	it('validates actual calendar dates including leap years', () => {
		expect(isIsoDate('2024-02-29')).toBe(true);
		for (const value of [
			'2026-02-29',
			'2026-13-01',
			'2026-04-31',
			'0000-01-01',
			'2026-01-00',
		])
			expect(isIsoDate(value)).toBe(false);
	});
});
