# Agent Workflow MVP

This document defines the first file-first protocol for using Noted folders as
agent workspaces through the Noted MCP server.

## Mapping

- Folder = project or codebase workspace.
- Workflow note = goal, tree index, global state, and event log.
- Task note = one task or subtask with acceptance criteria and evidence.
- Runs note = command executions, sandbox notes, timeouts, exit codes, output.
- Reviews note = model or human review findings.
- Output note = final acceptance check.

The MVP intentionally stays flat because the current MCP note model allows one
folder level. Tree structure is encoded by stable IDs and `parentId` fields.

## File Names

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
the user explicitly asks for cleanup.

## Metadata

The MVP does not require YAML frontmatter for agent state; it uses visible JSON
metadata instead. Noted still preserves Markdown YAML frontmatter by storing it
as a `noted-frontmatter` HTML comment when Markdown is converted to editor HTML,
then reattaching it on save.

Each agent note contains a visible JSON code block under `## Agent Metadata`:

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

The metadata block is deliberately visible so humans can inspect and repair it.
Future UI can render this as a tree without changing the file format.

## States

Workflow states:

```text
draft -> awaiting_plan_approval -> ready -> running -> awaiting_review -> awaiting_output_approval -> done
                                      -> blocked
                                      -> failed
                                      -> cancelled
```

Task states:

```text
todo -> ready -> claimed -> running -> review -> verified -> done
                    -> blocked
                    -> failed
                    -> stale
```

Run states:

```text
queued -> running -> succeeded
                 -> failed
                 -> timed_out
                 -> cancelled
                 -> needs_approval
```

## Approval Modes

```text
autonomous  Agent proceeds unless an operation is destructive or external.
plan        User approves the plan before task execution.
action      User approves risky commands, installs, deletes, network, broad edits.
review      Work needs model or human review before completion.
release     Final commit, push, PR, export, or publication needs approval.
manual      Major task transitions require human approval.
```

## Events

State changes and evidence should be append-only events. Use the MCP
`append_agent_event` tool instead of free-form state edits when possible.

Example:

```json
{
  "type": "TaskStatusChanged",
  "actor": "codex",
  "at": "2026-05-25T10:30:00.000Z",
  "nodeId": "T001",
  "status": "review",
  "summary": "Implementation ready for review",
  "details": {
    "tests": "npm run test -- mcp-server/index.test.ts passed"
  }
}
```

## MCP Tools

The MVP adds:

- `create_agent_workflow`: creates workflow, task, runs, reviews, and output
  notes inside a project folder.
- `append_agent_event`: appends structured JSON events to an agent note.

Existing note tools still work for normal reading, searching, and editing.
