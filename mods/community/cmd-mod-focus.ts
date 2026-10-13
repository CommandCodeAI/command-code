import type {ModApi} from './api.js';
import {hasControlCharacters} from './text.js';

const CUSTOM_TYPE = 'community-focus-goal';
export function readGoal(data: unknown): string | undefined {
	if (typeof data !== 'object' || data === null || !('goal' in data))
		return undefined;
	if (typeof data.goal !== 'string' || data.goal.length > 500)
		return undefined;
	return data.goal;
}
export default function register(cmd: ModApi): void {
	let goal = '';
	cmd.hooks({
		onSessionStart: () => {
			const entries =
				cmd.session?.getCustomEntries<unknown>({
					customType: CUSTOM_TYPE,
				}) ?? [];
			goal = readGoal(entries.at(-1)?.data) ?? '';
		},
		appendSystemPrompt: () =>
			goal
				? `User's current focus: ${goal}\nKeep changes scoped to this goal. Mention unrelated opportunities separately. Later explicit user instructions take precedence over this reminder.`
				: undefined,
	});
	cmd.addCommand({
		name: 'focus',
		description:
			'Set, inspect, or clear a persistent session focus reminder',
		argumentHint: '<goal|status|off>',
		handler: ({args}) => {
			const value = args.trim();
			if (!value || value === 'status')
				return {
					message: goal
						? `Focus: ${goal}`
						: 'No focus set. Use /focus <goal>.',
				};
			if (!cmd.isIdle())
				return {
					message:
						'Wait until the current run finishes before changing focus.',
				};
			if (value.length > 500 || hasControlCharacters(value))
				return {
					message:
						'Use a single-line goal of at most 500 characters.',
				};
			goal = value === 'off' ? '' : value;
			cmd.session?.appendCustomEntry({
				customType: CUSTOM_TYPE,
				data: {goal},
			});
			return {message: goal ? `Focus: ${goal}` : 'Focus cleared.'};
		},
	});
}
