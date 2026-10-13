// Structural subset of Command Code's ModApi. Type-only: no runtime dependencies.
// Command Code's community-mods contract tests check this against the actual API.
export interface Disposable {
	dispose(): void;
}
export interface CommandResult {
	readonly message?: string;
	readonly prompt?: string;
}
export interface ExecResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly code: number;
}
export interface ExecParams {
	readonly command: string;
	readonly args?: readonly string[];
	readonly cwd?: string;
}
export type ModExec = (params: ExecParams) => Promise<ExecResult>;
export interface CommandContext {
	readonly args: string;
	readonly cwd: string;
	readonly exec: ModExec;
}
export interface ModCommand {
	readonly name: string;
	readonly description: string;
	readonly argumentHint?: string;
	readonly handler: (
		ctx: CommandContext,
	) => CommandResult | Promise<CommandResult>;
}
export interface ModEvent {
	readonly type: string;
}
export interface SessionEntry<T> {
	readonly data?: T;
}
export interface SessionStore {
	appendCustomEntry<T = unknown>(params: {
		readonly customType: string;
		readonly data?: T;
	}): string;
	getCustomEntries<T = unknown>(params: {
		readonly customType: string;
	}): readonly SessionEntry<T>[];
}
export interface SessionNode {
	readonly id: string;
	readonly label?: string;
	readonly children: readonly SessionNode[];
}
export interface ContextUsage {
	readonly tokens: number | null;
	readonly contextWindow: number;
	readonly percent: number | null;
}
export interface ModHooks {
	readonly appendSystemPrompt?: () => string | undefined;
	readonly onSessionStart?: () => void;
}
export interface ModApi {
	readonly ui: {
		readonly capabilities: {readonly status: boolean};
		setStatus(text: string | null): Disposable;
		notify(text: string, level?: 'info' | 'warning' | 'error'): void;
	};
	readonly session: SessionStore | undefined;
	readonly sessions: {
		leafId(): string | null;
		tree(): readonly SessionNode[];
		setLabel(params: {
			readonly targetId: string;
			readonly label: string | undefined;
		}): void;
		navigateTree(params: {readonly targetId: string}): Promise<void>;
	};
	addCommand(command: ModCommand): Disposable;
	hooks(hooks: ModHooks): Disposable;
	on(
		event:
			| 'session_start'
			| 'run_start'
			| 'run_end'
			| 'run_error'
			| 'tool_completed'
			| 'tool_errored'
			| 'model_request_end'
			| 'compaction_done',
		handler: (event: ModEvent) => void,
	): Disposable;
	getContextUsage(): ContextUsage | undefined;
	isIdle(): boolean;
}
