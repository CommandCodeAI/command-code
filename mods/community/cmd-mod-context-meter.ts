import type {ModApi} from './api.js';
export function contextText(cmd: ModApi): string {
	const usage = cmd.getContextUsage();
	if (!usage || usage.tokens === null || usage.percent === null)
		return 'Context: not measured yet';
	const percent = Math.round(usage.percent);
	const hint = percent >= 80 ? ' — consider /compact before a new task' : '';
	return `Context: ${usage.tokens.toLocaleString('en-US')} / ${usage.contextWindow.toLocaleString('en-US')} tokens (${percent}%)${hint}`;
}
export default function register(cmd: ModApi): void {
	const refresh = (): void => {
		if (cmd.ui.capabilities.status) cmd.ui.setStatus(contextText(cmd));
	};
	cmd.on('session_start', refresh);
	cmd.on('model_request_end', refresh);
	cmd.on('compaction_done', refresh);
	cmd.on('run_end', refresh);
	cmd.addCommand({
		name: 'context-meter',
		description: 'Show the measured context budget and a compaction hint',
		handler: () => ({message: contextText(cmd)}),
	});
}
