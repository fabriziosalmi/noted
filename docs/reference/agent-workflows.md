# Agent workflows

::: info Advanced feature
Agent workflows are an advanced, developer-facing capability for orchestrating AI
agents against a Noted folder. They are driven through the
[MCP server](/reference/mcp-server); ordinary note-taking never requires them. The
in-app **Agent** panel appears only for notes that already contain agent-workflow
metadata.
:::

Agent workflows turn a Noted folder into an agent workspace using a **file-first**
protocol: the plan, tasks, runs, reviews, and state all live in normal notes, as
visible JSON you can read and repair by hand. A shared runtime engine — used by
both the MCP server and the app — enforces the state machine, approval gates, and
task dependencies so state cannot drift into an illegal shape.

## The mapping

| Note | Role |
| --- | --- |
| Folder | The project or codebase workspace |
| Workflow note | Goal, task index, global state, and event log |
| Task note | One task or subtask, with acceptance criteria and evidence |
| Runs note | Command executions: sandbox notes, timeouts, exit codes, output |
| Reviews note | Model or human review findings |
| Output note | The final acceptance check |

The model stays flat because the note store allows one level of folders. Tree
structure is encoded by stable IDs and `parentId` fields, not by nesting.

## File names

Use deterministic names inside the project folder:

```text
project-folder/
  wf-WF001-agent-runtime.md
  task-T001-schema.md
  task-T001.1-events.md
  task-T002-ui-panel.md
  runs-WF001.md
  reviews-WF001.md
  output-WF001.md
```

IDs are stable. Titles may change, but agents should avoid renaming files unless
you explicitly ask for cleanup.

## Metadata

Agent state is not YAML frontmatter — it is a **visible** JSON block under a
`## Agent Metadata` heading, so a human can inspect and repair it:

```json
{
  "notedAgent": true,
  "schemaVersion": 1,
  "type": "task",
  "id": "T001.1",
  "workflowId": "WF001",
  "parentId": "T001",
  "dependsOn": ["T001"],
  "status": "todo",
  "owner": null
}
```

(Noted still preserves ordinary Markdown YAML frontmatter separately, by storing
it as a `noted-frontmatter` HTML comment; see
[Architecture](/contributing/architecture#storage).)

## States

**Workflow**

```text
draft → awaiting_plan_approval → ready → running → awaiting_review
      → awaiting_output_approval → done
      → blocked / failed / cancelled
```

**Task**

```text
todo → ready → claimed → running → review → verified → done
     → blocked / failed / stale
```

**Run**

```text
queued → running → succeeded / failed / timed_out / cancelled / needs_approval
```

Illegal transitions are rejected by the engine.

## Approval modes

Each workflow runs under an approval mode that decides which checkpoints require
sign-off:

| Mode | Requires approval for |
| --- | --- |
| `autonomous` | Nothing (unless an operation is destructive or external) |
| `plan` | The plan, before task execution |
| `action` | Risky commands, installs, deletes, network, broad edits |
| `review` | Work must be reviewed before completion |
| `release` | Final commit, push, PR, export, or publication |
| `manual` | All major transitions |

## Gates and enforcement

The engine enforces approval modes by **detecting bypasses**: a direct transition
that would skip a gate's request state is refused. For example, under `plan` mode
a workflow cannot jump `draft → ready` because that skips the plan gate; the
engine returns a `gate_required` error instead.

Gate states are exit-only, via approval or rejection:

- Workflow: `awaiting_plan_approval`, `awaiting_review`, `awaiting_output_approval`
- Task: `review`
- Run: `needs_approval`

Approving moves to the gate's approve target; rejecting moves a workflow or task
to `blocked` (or a run to `cancelled`), recording the reason. A blocked workflow
is recoverable by restarting through `draft`.

Tasks additionally respect **dependencies**: a task cannot become `ready`,
`claimed`, or `running` until every task in its `dependsOn` is `verified` or
`done`.

## Events

State changes and evidence are append-only events. Prefer the
`append_agent_event` tool over free-form edits:

```json
{
  "type": "TaskStatusChanged",
  "actor": "agent",
  "at": "2026-05-25T10:30:00.000Z",
  "nodeId": "T001",
  "status": "review",
  "summary": "Implementation ready for review"
}
```

## MCP tools

| Tool | Purpose |
| --- | --- |
| `create_agent_workflow` | Scaffold the workflow, task, runs, reviews, and output notes in a folder |
| `append_agent_event` | Append a structured JSON event to an agent note |
| `advance_agent_state` | Move a workflow/task note to a new status (enforcing the machine, gates, and dependencies) |
| `approve_agent_gate` | Resolve the pending gate, moving to its approve target |
| `reject_agent_gate` | Move the pending gate to blocked/cancelled with a reason |

`create_agent_workflow` takes the folder, a workflow id, title, and goal, an
optional `approval_mode` (default `plan`), and an optional list of tasks (each
with an id, title, optional `parent_id`, and optional `depends_on`).

## Optimistic concurrency

Because an agent and a human may touch the same note, the `advance_agent_state`,
`approve_agent_gate`, and `reject_agent_gate` tools accept an optional
`expected_updated_at`. If the note changed since it was read, the call fails with
a `stale` error rather than clobbering the newer state.

## The Agent panel

Inside the app, the **Agent** right-panel drives the *same* engine as the MCP
tools — Approve, Reject, and Advance operate through `advance` / `approveGate` /
`rejectGate` and persist the note. When a task's governing workflow cannot be
found, both callers fail safe to `manual` mode.

## Current status

The workflow and task lifecycles are fully wired end-to-end. Two parts of the
schema are defined but not yet exercised by the shipped tools:

- The **run lifecycle** (the `queued → running → …` states) — scaffolded `runs`
  notes are treated as evidence logs, and no shipped tool advances a governed
  `run`.
- The **`action` approval mode** — it is accepted and stored, but does not yet
  gate any workflow or task transition.

Treat both as reserved for a future revision rather than active checkpoints.

## Where it lives

The engine is a pure, well-tested module in `shared/agent/` (`types`,
`stateMachine`, `gates`, `dependencies`, `engine`, `metadataBlock`), shared
verbatim between the MCP server and the renderer so both enforce identical rules.
