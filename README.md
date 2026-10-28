# NocoMonitor

English | [简体中文](docs/README.zh-CN.md)

NocoMonitor is an open-source, AI-native uptime monitor built on [NocoBase 3](https://www.nocobase.com). It checks your services around the clock, opens an incident the moment one fails, and has an agent find the cause, so you read a root cause instead of a red dot. Where you allow it, the agent can also request a fix. Agents propose; the probes verify.

## What it does

- **Checks around the clock.** HTTP status, keyword and JSON checks on your schedule, with response time charts and 90-day uptime bars.
- **Incidents open themselves.** Consecutive failures open an incident and recovery resolves it, with a timeline of every check and update.
- **An agent finds the cause.** It reads the checks, compares the service's other monitors, probes again and reads the service's source code, then records the root cause, its confidence and the next steps on the incident.
- **Fixes within your guardrails.** Each service lists the fixed HTTP calls it allows, such as a deploy hook or a restart endpoint. Each monitor decides how far the agent may go: diagnose only, suggest, fix after approval, or fix automatically. The probes, not the agent, decide whether a fix worked, and a fix that did not help goes back to people.
- **Public status pages.** Share the health of the services you choose, with only the incidents and updates you mark public.
- **Your code.** Open source, self-hosted, and a NocoBase 3 application you change by asking a coding agent.

## Quick start

### 1. Install

**With a coding agent.** Open Claude Code, Codex or Cursor where NocoMonitor should go, and give it this:

```text
Install NocoMonitor from https://github.com/gchust/NocoMonitor and start it, following its AGENTS.md and README.
```

**By hand.** You need Node.js 24 or later and pnpm 11 (`corepack enable`). The data goes into a SQLite file by default; PostgreSQL works too.

```bash
git clone https://github.com/gchust/NocoMonitor.git
cd NocoMonitor
pnpm install
pnpm nocobase config init --dialect sqlite
pnpm dev
```

### 2. Sign in

Open the `Local:` address `pnpm dev` prints, normally `http://127.0.0.1:13000/main/`, and sign in as `nocobase` with the password `admin123`. Change the password before exposing NocoMonitor anywhere.

### 3. Add what to watch

A new installation already monitors the [NocoBase solution demos](https://solutions.nocobase.com/crm/) (NocoCRM, NocoITAM and NocoReach) as an example. Add your own on **Services** and **Monitors**, and publish a page on **Status pages**.

### 4. Connect an agent

AI diagnosis runs on a runtime: a machine with Claude Code or Codex signed in. Connect one on **Agent management → Runtimes**, enable an agent on **Agents**, and choose it on **AI diagnosis**. Everything else works without it. A runtime has full access to its machine, so give it a dedicated machine or VM.

## Development

NocoMonitor is a NocoBase 3 application: [AGENTS.md](AGENTS.md) is where a coding agent, or you, starts.

## License

[Apache License 2.0](LICENSE)
