import type {ModApi} from './api.js';
export interface RunStats {
	readonly startedAt: number | null;
	readonly elapsedMs: number;
	readonly completed: number;
	readonly failed: number;
	readonly running: boolean;
}
export function emptyStats(): RunStats {
	return {
		startedAt: null,
		elapsedMs: 0,
		completed: 0,
		failed: 0,
		running: false,
	};
}
export function formatStats(stats: RunStats, now: number): string {
	if (stats.startedAt === null) return 'Run stats: no run yet';
	const elapsed = stats.running
		? Math.max(0, now - stats.startedAt)
		: stats.elapsedMs;
	return `Run stats: ${(elapsed / 1000).toFixed(1)}s, ${stats.completed} completed tools, ${stats.failed} failed tools (${stats.running ? 'running' : 'finished'})`;
}
export default function register(cmd: ModApi): void {
	let stats = emptyStats();
	const finish = (): void => {
		if (stats.startedAt === null || !stats.running) return;
		stats = {
			...stats,
			elapsedMs: Math.max(0, Date.now() - stats.startedAt),
			running: false,
		};
	};
	cmd.on('session_start', () => {
		stats = emptyStats();
	});
	cmd.on('run_start', () => {
		stats = {...emptyStats(), startedAt: Date.now(), running: true};
	});
	cmd.on('tool_completed', () => {
		if (stats.running) stats = {...stats, completed: stats.completed + 1};
	});
	cmd.on('tool_errored', () => {
		if (stats.running) stats = {...stats, failed: stats.failed + 1};
	});
	cmd.on('run_end', finish);
	cmd.on('run_error', finish);
	cmd.addCommand({
		name: 'run-stats',
		description:
			'Show elapsed time and successful/failed tools for the latest run',
		handler: () => ({message: formatStats(stats, Date.now())}),
	});
}
