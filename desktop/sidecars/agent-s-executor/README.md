# Agent-S Executor Mock Sidecar

This service is the first local Agent-S sidecar skeleton for Kaypal Desktop.
It currently defaults to a local mock runner. The runner layer is now
abstracted so the real Agent-S runtime can be connected later without
changing the HTTP API or the Electron integration.

The mock runner simulates:

- session creation
- ordered event sequences
- artifact directory creation
- placeholder screenshot files
- cancellation and failure paths

## Files

- `main.py`: FastAPI entrypoint and mock run orchestration
- `models.py`: request, response, session, event, and artifact models
- `session_store.py`: in-memory session and event store
- `artifact_store.py`: local artifact writer and artifact index
- `config.py`: local settings and defaults
- `runner.py`: pluggable runner layer (`mock` now, `real` later)
- `requirements.txt`: Python dependencies

## Local auth

All endpoints require the header:

`x-kaypal-agent-s-token: <token>`

Default token:

(empty — no built-in default; the desktop main process generates a per-device token and injects it via `KAYPAL_AGENT_S_TOKEN`)

Override it with:

`KAYPAL_AGENT_S_TOKEN`

## Runner mode

Default runner mode:

`mock`

Override it with:

`KAYPAL_AGENT_S_RUNNER_MODE=mock`

Real mode:

`KAYPAL_AGENT_S_RUNNER_MODE=real`

When `runner_mode=real`, the sidecar now supports two provider modes:

- `KAYPAL_AGENT_S_REAL_PROVIDER=external_http`
- `KAYPAL_AGENT_S_REAL_PROVIDER=agent_s_sdk`

`external_http` keeps the old local HTTP adapter behavior.

Required for `external_http`:

- `KAYPAL_AGENT_S_EXTERNAL_AGENT_BASE_URL=http://127.0.0.1:18888`

Optional for `external_http`:

- `KAYPAL_AGENT_S_EXTERNAL_AGENT_API_KEY`
- `KAYPAL_AGENT_S_EXTERNAL_AGENT_TIMEOUT_MS=30000`

`agent_s_sdk` is the new direct Agent-S SDK adapter.

Typical settings for `agent_s_sdk`:

- `KAYPAL_AGENT_S_REAL_PROVIDER=agent_s_sdk`
- `KAYPAL_AGENT_S_SDK_API_KEY=<model-api-key>`
- `KAYPAL_AGENT_S_SDK_MODEL=gpt-4o`

Optional for `agent_s_sdk`:

- `KAYPAL_AGENT_S_SDK_MODEL_PROVIDER=openai`
- `KAYPAL_AGENT_S_SDK_BASE_URL=...`
- `KAYPAL_AGENT_S_SDK_PLATFORM=windows`
- `KAYPAL_AGENT_S_SDK_MAX_STEPS=3`
- `KAYPAL_AGENT_S_SDK_ACTION_SPACE=pyautogui`
- `KAYPAL_AGENT_S_SDK_OBSERVATION_TYPE=mixed`
- `KAYPAL_AGENT_S_SDK_SEARCH_ENGINE=openai`

If the machine does not have the `gui_agents` package installed, the sidecar
still starts normally. The failure happens only when a real Agent-S SDK run is
requested, and the session will fail with a clear configuration error.

## Bind address

The service only binds to:

`127.0.0.1`

Default port:

`17777`

## Endpoints

- `GET /healthz`
- `GET /status`
- `POST /sessions`
- `POST /sessions/{session_id}/run`
- `GET /sessions/{session_id}`
- `GET /sessions/{session_id}/events?after_seq=0`
- `POST /sessions/{session_id}/cancel`
- `POST /sessions/{session_id}/approval`
- `GET /sessions/{session_id}/artifacts`
- `POST /stop`

When `runner_mode=real`, both `GET /healthz` and `GET /status` now also report:

- `real_provider=external_http`
- or `real_provider=agent_s_sdk`

## Run

```bash
cd /Users/yanghy/Documents/New\ project/kaypal-ai/services/agent-s-executor
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 main.py
```

## Real-mode external HTTP contract

The sidecar calls:

`POST {KAYPAL_AGENT_S_EXTERNAL_AGENT_BASE_URL}/run`

Request body:

```json
{
  "session": {
    "session_id": "ags_123",
    "run_id": "run_123",
    "task_type": "desktop.gui.visual.real"
  },
  "instruction": "Open WeChat and draft a safe reply without sending",
  "risk_level": "medium",
  "requires_approval": false,
  "metadata": {
    "window_title": "WeChat"
  }
}
```

Expected response body:

```json
{
  "status": "completed",
  "summary": "GUI task completed successfully.",
  "steps": [
    {
      "step_index": 1,
      "title": "Observe desktop",
      "summary": "Captured current desktop context.",
      "status": "completed",
      "screenshot_base64": "<base64-png>"
    }
  ],
  "artifacts": [
    {
      "kind": "text",
      "name": "external-agent-summary.txt",
      "text": "Summary text"
    },
    {
      "kind": "json",
      "name": "external-agent-plan.json",
      "json": {
        "next_action": "draft_reply"
      }
    },
    {
      "kind": "screenshot",
      "name": "external-agent-final-screen.png",
      "base64": "<base64-png>"
    }
  ],
  "requires_user_confirmation": false
}
```

Supported response fields:

- `status`: `completed`, `failed`, or `waiting_approval`
- `summary`: final run summary shown in Kaypal
- `steps[]`: ordered desktop steps to persist as events and JSON artifacts
- `steps[].screenshot_base64`: optional PNG or data URL payload
- `artifacts[]`: optional file outputs
- `requires_user_confirmation=true`: converts the session into `waiting_approval`

When a real-mode run returns `requires_user_confirmation=true`, Kaypal Desktop
can close the approval checkpoint manually with:

`POST /sessions/{session_id}/approval`

Request body:

```json
{
  "decision": "approved",
  "comment": "Approved from Kaypal Desktop."
}
```

Supported decisions:

- `approved`: resumes the real-mode external agent from the approval checkpoint
- `rejected`: marks the session `failed`

Artifacts returned by the external agent are normalized into the same local
artifact store used by the mock runner, so Electron does not need a separate
display path for real mode.

## Real-mode Agent-S SDK adapter

When `KAYPAL_AGENT_S_REAL_PROVIDER=agent_s_sdk`, the sidecar tries to import
the public Agent-S Python package (`gui_agents`) and adapt its prediction loop
into the Kaypal session timeline.

Current behavior of the first SDK adapter slice:

- every SDK prediction is persisted as a JSON artifact
- each prediction also becomes a `step_started` + `step_completed` pair
- if `requires_approval=true`, the adapter pauses after the first SDK step and
  emits a normal `approval_required` checkpoint
- approval resume now performs a second real SDK prediction and normalizes the
  resumed step back into the same event and artifact model

This first slice is intentionally conservative. It gives Kaypal a stable
provider boundary for the real Agent-S SDK without changing the desktop-side API.

## Offline SDK smoke

For local adapter validation without installing the real Agent-S SDK, run:

```bash
bash services/agent-s-executor/scripts/smoke-agent-s-sdk.sh
```

This script creates a local stub `gui_agents.s3` package plus a fake
`pyautogui`, launches the sidecar in `agent_s_sdk` mode, and verifies that
the Kaypal adapter can:

- boot in `real` mode
- expose `real_provider=agent_s_sdk`
- complete a minimal SDK-backed session
- pause on approval and resume into a second SDK-backed step
- persist the expected events and JSON artifacts

This is meant for adapter regression coverage. It does **not** replace a
real on-machine validation with the actual `gui_agents` package installed.

## Real approval-resume verification

After the machine is prepared for real GUI smoke, the live sidecar smoke now
also validates the approval path:

```bash
bash services/agent-s-executor/scripts/smoke-agent-s-sdk-sidecar-live.sh
```

This now covers both:

- a direct real `agent_s_sdk` `/run` that completes
- an approval-gated real `agent_s_sdk` `/run` that:
  - enters `waiting_approval`
  - accepts `POST /sessions/{session_id}/approval`
  - performs a resumed second SDK prediction
  - reaches `completed`
  - writes resumed artifacts such as:
    - `external-agent-approval-response.json`
    - `agent-s-sdk-step-002.json`
    - `agent-s-sdk-post-approval.txt`

## Real on-machine self-check

After installing the real dependencies into the sidecar virtualenv, run:

```bash
/Users/yanghy/Documents/New\ project/kaypal-ai/services/agent-s-executor/.venv/bin/python \
  services/agent-s-executor/scripts/selfcheck_real_agent_s.py
```

This checks:

- `gui_agents` import
- `pyautogui` import
- `PIL` import
- macOS Screen Recording permission
- macOS Accessibility permission
- best-effort screenshot capture

If imports pass but permissions fail, the machine still is **not** ready for
real GUI execution until those macOS permissions are granted.

## Real live SDK smoke

Once the machine has:

- `gui_agents` installed
- `pyautogui` installed
- Screen Recording permission
- Accessibility permission
- a usable vision-capable model API key

run:

```bash
bash services/agent-s-executor/scripts/smoke-agent-s-sdk-live.sh
```

This performs a real on-machine screenshot, constructs an `AgentS3` instance,
and attempts one minimal live `predict(...)` call.

## Real sidecar run-path smoke

To verify the full sidecar HTTP `/sessions -> /run -> /events -> /artifacts`
path with the real `agent_s_sdk` provider, run:

```bash
bash services/agent-s-executor/scripts/smoke-agent-s-sdk-sidecar-live.sh
```

This launches the sidecar in:

- `runner_mode=real`
- `real_provider=agent_s_sdk`

Then it validates a true end-to-end run with:

- real desktop screenshot capture
- real Agent-S SDK prediction
- sidecar event emission
- screenshot and JSON artifact persistence
- approval-gated resume over the real SDK path
- full-access execution with both target and text-input allowlists

Notes:

- The real cloud-backed live smoke now relies on the grounding lane inheriting
  the primary SDK API key by default when no dedicated
  `KAYPAL_AGENT_S_SDK_GROUND_API_KEY` is set.
- For execute-mode validation, the smoke explicitly passes both:
  - `allowed_desktop_action_targets=["Finder"]`
  - `allowed_desktop_text_inputs=["Finder"]`
  because `agent.open("Finder")` expands into a Spotlight sequence that
  includes text entry.

## Real local sidecar live-action smoke

To verify the controlled local action lane without depending on a remote model
gateway, run:

```bash
bash services/agent-s-executor/scripts/smoke-agent-s-sdk-sidecar-local-live.sh
```

This launches the sidecar in:

- `runner_mode=real`
- `real_provider=agent_s_sdk`

But instead of using a cloud-backed vision model, it injects a local stub
`gui_agents.s3` package while keeping the real local desktop environment:

- real macOS permissions
- real screenshot capture
- real sidecar HTTP path
- real `pyautogui` action execution

Then it validates:

- a real session can be created over HTTP
- a real `/run` can complete in `local_controller_permission_mode=full`
- the allowed target whitelist is honored
- the execution artifact is written with `status=executed`
- normalized step, screenshot, policy, action, and action-execution artifacts exist

## Example

```bash
TOKEN="${KAYPAL_AGENT_S_TOKEN:-}"
BASE=http://127.0.0.1:17777

curl -s -H "x-kaypal-agent-s-token: ${TOKEN}" "${BASE}/healthz"

curl -s \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-kaypal-agent-s-token: ${TOKEN}" \
  -d '{"session_name":"desktop-demo","task_type":"wechat.reply.draft"}' \
  "${BASE}/sessions"
```

Run request body example:

```json
{
  "instruction": "Draft a reply in the desktop client",
  "risk_level": "medium",
  "requires_approval": false,
  "step_count": 3,
  "mock_step_delay_ms": 250
}
```

## Artifact layout

Artifacts are written under:

`services/agent-s-executor/data/<session_id>/`

Layout:

```text
data/<session_id>/
  events/
    events.jsonl
  runs/<run_id>/
    request.json
    step-001-note.txt
    screenshots/step-001-mock-screen.png
    session-summary.json
```

The screenshot file is a valid placeholder PNG so the desktop shell can test
artifact discovery before the real Agent-S integration lands.

## Notes

- Sessions and artifact index are in memory for this first slice.
- Artifact files are persisted locally on disk.
- Health and status payloads expose `runner_mode` so the desktop shell can show
  whether the sidecar is still in mock mode.
- `artifact_count` in the session payload is synced from the current local artifact list.
- `requires_approval=true` emits an approval checkpoint event, then auto-approves
  it in the mock runner because this slice does not include a resume endpoint yet.
- `simulate_failure_step` can be used to force a failure for UI testing.
- `runner_mode=real` already supports a stable external HTTP adapter contract, so
  the real Agent-S integration can focus on translating GUI plans instead of
  changing the Kaypal Desktop boundary again.
- Approval checkpoints are now first-class session states instead of display-only
  placeholders. In `runner_mode=real`, an approval can now resume execution by
  calling the external agent's `/approval` endpoint and persisting a second-stage
  response into the same session timeline.
- The real-mode smoke test now also verifies the reject path, so both
  `approval_granted` and `approval_rejected` flows stay covered.

## Real-mode smoke test

The repo now includes a local fake external agent plus a one-command smoke path:

```bash
bash services/agent-s-executor/scripts/smoke-real-runner.sh
```

This starts:

- `scripts/mock_external_agent.py`
- the sidecar in `runner_mode=real`

Then it verifies:

- `/healthz` reports `runner_mode=real`
- session creation and run acceptance work
- the sidecar reaches `completed`
- expected events are emitted
- expected external artifacts are persisted locally
- a second real-mode run can pause in `waiting_approval`
- approving that checkpoint resumes execution and reaches `completed`
