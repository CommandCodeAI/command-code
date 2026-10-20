# RFC-001: Multi-Agent Visual Indicator for Active Sessions

**Status**: Draft
**Author**: Feature Request (via Community)
**Created**: 2026-09-08
**Related Issue**: #817

## Summary

Add a persistent visual indicator in the Command Code CLI that shows users when multiple agents are running concurrently within a session. This provides real-time awareness of active subagent work — similar to implementations in T3 Code (by Theo) and Codex.

## Motivation

When Command Code delegates work to multiple subagents via the `agent` tool, users currently have no visibility into:

- Which agents are running
- How many are active
- What each agent is working on
- Their current status (running, completed, failed)

This makes the main session appear idle while invisible work happens in the background, and makes debugging failed agents difficult.

## Design

### Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Session UI (Ink/React)                   │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────┐  │
│  │              AgentStatusBar (new)                      │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐                 │  │
│  │  │AgentBadge│ │AgentBadge│ │AgentBadge│  +2 more...    │  │
│  │  └─────────┘ └─────────┘ └─────────┘                 │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Main Conversation Area                    │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### TypeScript Interfaces

```typescript
// ─── Agent Status Types ───────────────────────────────────────────────

type AgentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'killed';

interface AgentIdentity {
  /** Unique agent identifier (from agent_id returned by agent tool) */
  id: string;
  /** Agent name/type: 'general' | 'explore' | 'plan' | custom name */
  name: string;
  /** Optional custom color for the badge (hex or ansi color) */
  color?: string;
}

interface AgentTask {
  /** Short description of what the agent is doing */
  description: string;
  /** Timestamp when the agent started */
  startedAt: number;
  /** Optional: estimated completion (for progress indication) */
  progress?: number; // 0-100
}

interface ActiveAgent extends AgentIdentity, AgentTask {
  status: AgentStatus;
  /** Error message if status is 'failed' */
  error?: string;
  /** Token usage stats (populated on completion) */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };
}

// ─── AgentStatusBar Configuration ─────────────────────────────────────

interface AgentIndicatorConfig {
  /** Whether the indicator is visible */
  enabled: boolean;
  /** Display style */
  style: 'compact' | 'detailed' | 'minimal';
  /** Maximum number of badges to show before collapsing */
  maxVisible: number;
  /** Show token usage on completion */
  showUsage: boolean;
  /** Animation enabled for running state */
  animate: boolean;
}

// ─── Default Configuration ────────────────────────────────────────────

const DEFAULT_CONFIG: AgentIndicatorConfig = {
  enabled: true,
  style: 'compact',
  maxVisible: 5,
  showUsage: true,
  animate: true,
};
```

### Status Badge Component

```typescript
// ─── AgentBadge Component ──────────────────────────────────────────────

import React from 'react';
import { Box, Text } from 'ink';

interface AgentBadgeProps {
  agent: ActiveAgent;
  compact?: boolean;
}

const STATUS_ICONS: Record<AgentStatus, string> = {
  queued: '◌',
  running: '●', // Spinner in practice
  completed: '✓',
  failed: '✗',
  killed: '⊘',
};

const STATUS_COLORS: Record<AgentStatus, string> = {
  queued: 'gray',
  running: 'cyan',
  completed: 'green',
  failed: 'red',
  killed: 'yellow',
};

export function AgentBadge({ agent, compact }: AgentBadgeProps) {
  const icon = STATUS_ICONS[agent.status];
  const color = STATUS_COLORS[agent.status];

  if (compact) {
    return (
      <Box marginRight={1}>
        <Text color={color}>{icon} </Text>
        <Text bold>{agent.name}</Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="round" borderColor={color} paddingX={1} marginRight={1}>
      <Text color={color}>{icon} </Text>
      <Text bold>{agent.name}</Text>
      <Text dimColor> — {truncate(agent.description, 40)}</Text>
    </Box>
  );
}
```

### Status Bar Component

```typescript
// ─── AgentStatusBar Component ──────────────────────────────────────────

interface AgentStatusBarProps {
  agents: ActiveAgent[];
  config: AgentIndicatorConfig;
}

export function AgentStatusBar({ agents, config }: AgentStatusBarProps) {
  if (!config.enabled || agents.length === 0) return null;

  const running = agents.filter(a => a.status === 'running');
  const completed = agents.filter(a => a.status === 'completed');
  const failed = agents.filter(a => a.status === 'failed');
  const queued = agents.filter(a => a.status === 'queued');

  const visibleAgents = agents.slice(0, config.maxVisible);
  const remaining = agents.length - config.maxVisible;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Summary line */}
      <Box>
        <Text bold>🤖 </Text>
        <Text>{agents.length} agent{agents.length !== 1 ? 's' : ''} </Text>
        {running.length > 0 && <Text color="cyan">● {running.length} running </Text>}
        {completed.length > 0 && <Text color="green">✓ {completed.length} done </Text>}
        {failed.length > 0 && <Text color="red">✗ {failed.length} failed </Text>}
        {queued.length > 0 && <Text color="gray">◌ {queued.length} queued</Text>}
      </Box>

      {/* Detailed badges (if style is 'detailed') */}
      {config.style === 'detailed' && (
        <Box marginTop={1} flexWrap="wrap">
          {visibleAgents.map(agent => (
            <AgentBadge key={agent.id} agent={agent} />
          ))}
          {remaining > 0 && <Text dimColor>+{remaining} more</Text>}
        </Box>
      )}
    </Box>
  );
}
```

### Session Integration

```typescript
// ─── Integration with Session State ────────────────────────────────────

// In the main session state store:
interface SessionState {
  // ... existing state
  activeAgents: Map<string, ActiveAgent>;
}

// When agent tool is called:
function handleAgentStart(params: AgentStartParams): string {
  const agentId = generateId();
  const activeAgent: ActiveAgent = {
    id: agentId,
    name: params.agentName,
    description: params.taskDescription,
    status: 'running',
    startedAt: Date.now(),
  };
  sessionState.activeAgents.set(agentId, activeAgent);
  renderAgentStatusBar(); // Trigger re-render
  return agentId;
}

// When agent completes (via agent_output):
function handleAgentComplete(agentId: string, result: AgentResult): void {
  const agent = sessionState.activeAgents.get(agentId);
  if (agent) {
    agent.status = result.success ? 'completed' : 'failed';
    agent.error = result.error;
    agent.usage = result.usage;
    renderAgentStatusBar();
  }
}
```

### Settings Schema

```json
{
  "agentIndicator": {
    "enabled": true,
    "style": "compact",
    "maxVisible": 5,
    "showUsage": true,
    "animate": true
  }
}
```

## Visual Mockups

### Compact Style (Default)
```
  🤖 3 agents ● 2 running ✓ 1 done

  ┌────────────────────────────────────────────────────────┐
  │  User: Can you refactor the auth module?               │
  │  Assistant: I'll delegate this to multiple agents...   │
  └────────────────────────────────────────────────────────┘
```

### Detailed Style
```
  ┌────────────────────────────────────────────────────────┐
  │  🤖 4 agents ● 2 running ✓ 1 done ✗ 1 failed         │
  │                                                        │
  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
  │  │● Explore │ │● General │ │✓ Plan    │ │✗ Tester  │  │
  │  │ searching│ │ refactor │ │ design   │ │ timeout  │  │
  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
  └────────────────────────────────────────────────────────┘
```

### Minimal Style
```
  🤖 ●●●○  (running dots + queued)
```

## Behavior

### Lifecycle
1. **Agent Started** → Badge appears with spinner
2. **Agent Running** → Spinner animates, optional progress %
3. **Agent Completed** → Badge turns green with ✓, shows token usage
4. **Agent Failed** → Badge turns red with ✗, shows error on hover/expand
5. **Session Ends** → All agents cleared from display

### Auto-Cleanup
- Completed/failed badges fade after 30s (configurable)
- Or persist until next user message
- User can manually dismiss with keypress

### Interaction
- Press `Tab` to cycle through active agents
- Press `A` to toggle agent panel (detailed view)
- Click/tap badge to see full output (in supported terminals)

## Migration Path

### Phase 1: Passive Indicator
- Show agent status without interaction
- Read-only display, no controls
- Behind feature flag `agentIndicator.enabled`

### Phase 2: Interactive Controls
- Expand/collapse agent details
- Kill running agents from UI
- View agent output inline

### Phase 3: Advanced Features
- Agent timeline visualization
- Performance metrics per agent
- Agent output streaming in real-time

## Open Questions

1. **Position**: Status bar at top vs bottom of terminal?
2. **Persistence**: Should completed agents persist or auto-dismiss?
3. **Streaming**: Should we stream agent output live or only on completion?
4. **Theming**: Should badge colors follow terminal theme or be fixed?
5. **Mobile**: How does this render in mobile/remote terminal setups?

## References

- T3 Code agent indicator (Theo)
- Codex multi-agent UI
- GitHub issue #817
