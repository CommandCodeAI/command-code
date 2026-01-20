# CommandCode

Command code with your taste.

> Stop fixing sloppy AI code. Command Code continuously learns your coding taste. Powered by taste-1 applied meta neuro-symbolic AI.

## Installation

```bash
npm i -g command-code
```

## Usage

Start an interactive chat session:

```bash
cmd
```

Use `cmd --help` to see all available options.

## What is Taste?

Taste learning automatically learns your coding preferences and style from conversations. It analyzes patterns in your corrections and stated preferences, storing them in project-specific files.

**What Taste learns:**

- Your coding style preferences (const vs let, functional vs class components)
- Framework and library choices
- Code structure and patterns you prefer
- Testing and documentation practices
- Communication style preferences

**How it works:**

- Learns from explicit preferences ("Please always use TypeScript")
- Learns from repeated corrections you make
- Creates rules with confidence scores (0.0-1.0)
- Only applies rules with confidence > 0.3
- Organizes learnings by category when you have more than 5

Taste learning is **enabled by default**. Learnings are automatically stored in `.commandcode/taste/taste.md` with confidence scores. As it grows, learnings automatically split into multiple files and folders by category (e.g., `cli/`, `typescript/`, `architecture/`). Use `/taste` in the CLI to toggle it on or off.

**Try it:** State your preferences or make corrections during chat to see taste learning in action!

## Interactive Commands

Available during chat sessions:

- `/login` - Authenticate with CommandCode via browser (zero-copy auth)
- `/logout` - Sign out from CommandCode
- `/taste` - Toggle taste learning on or off
- `/share` - Create a shareable link for the conversation
- `/unshare` - Stop sharing the conversation
- `/resume` - Resume a past conversation
- `/memory` - Manage project memory (persistent context)
- `/clear` - Clear the conversation history

## Authentication

CommandCode uses browser-based authentication for a secure, seamless login experience:

1. Run `/login` in the CLI
2. Your browser opens automatically to CommandCode Studio
3. Click "Approve" to authorize the CLI
4. You're authenticated! The CLI receives your credentials automatically

No need to copy-paste API keys - authentication happens securely in the background.

## Try These Examples

- Build a chrome extension to snooze a tab for 5s, 1min, and 10mins.
- Analyze this repo and suggest three high impact PRs
- Build a zero-config, single-file Node.js/TypeScript CLI named `passgen` that generates a random secure password.
- Build a modern React financial dashboard using shadcn/ui components with stock prices, market indices, and currency converter.

## Beta Release & Feedback

This is a beta version, and we are actively working on improvements. Expect some rough edges and occasional bugs as we refine the experience. Your feedback is invaluable. Join our Discord community: https://commandcode.ai/discord

## Author

[Ahmad Awais](https://x.com/MrAhmadAwais)
