# Sidecar verification notes

## Goal

Provide a minimal, low-friction way to validate that the `agent-s-executor`
sidecar workspace is wired for local checks and that a locally running process,
if available, responds on a standard health endpoint.

## Validation levels

### 1. Static asset validation

Run:

```bash
bash services/agent-s-executor/scripts/smoke-sidecar.sh
```

This validates:

- expected files exist
- scripts are executable
- Python syntax check passes when `python3` is present
- real-mode bootstrap scripts exist

### 2. Structured self-check

Run:

```bash
python3 services/agent-s-executor/scripts/selfcheck_sidecar.py
```

This emits a concise pass/fail summary and exits non-zero on failure.

### 3. Live probe against a running sidecar

If a local sidecar instance is already running:

```bash
SIDECAR_URL=http://127.0.0.1:8000 \
  bash services/agent-s-executor/scripts/smoke-sidecar.sh
```

or:

```bash
SIDECAR_URL=http://127.0.0.1:8000 \
  python3 services/agent-s-executor/scripts/selfcheck_sidecar.py
```

The probe tries:

1. `/healthz`
2. `/readyz`
3. `/health`
4. `/ready`

The first `2xx` response counts as success for this bootstrap phase.

### 4. Real-mode end-to-end smoke

Run:

```bash
bash services/agent-s-executor/scripts/smoke-real-runner.sh
```

This spins up:

1. `scripts/mock_external_agent.py`
2. the sidecar in `KAYPAL_AGENT_S_RUNNER_MODE=real`

Then it validates:

- `/healthz` returns `runner_mode=real`
- session creation succeeds
- run acceptance succeeds
- the real runner reaches a terminal `completed` state
- an approval-gated run can pause, resume, and complete
- a rejected approval-gated run fails cleanly
- expected events are emitted:
  - `session_started`
  - `step_started`
  - `step_completed`
  - `artifact_captured`
  - `run_completed`
- expected external artifacts are written locally:
  - `external-agent-response.json`
  - `external-agent-summary.txt`
  - `external-agent-plan.json`
  - `external-agent-final-screen.png`

## Approval checkpoint verification

For runs that return `requires_user_confirmation=true`:

1. Poll `GET /sessions/{session_id}` until the status becomes `waiting_approval`
2. Confirm an `approval_required` event exists in `GET /sessions/{session_id}/events`
3. Submit:

```bash
curl -s \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-kaypal-agent-s-token: ${TOKEN}" \
  -d '{"decision":"approved","comment":"Approved from smoke test"}' \
  "${BASE}/sessions/${SESSION_ID}/approval"
```

4. Confirm the session becomes `completed`
5. Confirm an `approval_granted` event is appended
6. Confirm post-approval artifacts exist, such as:
   - `external-agent-approval-response.json`
   - `external-agent-post-approval.txt`

For rejection coverage:

1. Start another `requires_user_confirmation=true` run
2. Submit `{"decision":"rejected"}`
3. Confirm the session becomes `failed`
4. Confirm `approval_rejected` and `run_failed` are both appended

### 5. Offline Agent-S SDK adapter smoke

Run:

```bash
bash services/agent-s-executor/scripts/smoke-agent-s-sdk.sh
```

This smoke does not require a real Agent-S installation or network access.
It creates a local stub `gui_agents.s3` package and a fake `pyautogui`
module, then starts the sidecar in:

- `KAYPAL_AGENT_S_RUNNER_MODE=real`
- `KAYPAL_AGENT_S_REAL_PROVIDER=agent_s_sdk`

Then it validates:

- `/healthz` returns `runner_mode=real`
- `/healthz` returns `real_provider=agent_s_sdk`
- session creation succeeds
- run acceptance succeeds
- the SDK adapter reaches a terminal `completed` state
- an approval-gated SDK run can pause, resume, and complete
- expected events are emitted:
  - `session_started`
  - `step_started`
  - `step_completed`
  - `artifact_captured`
  - `run_completed`
- expected adapter artifacts are written locally:
  - `external-agent-response.json`
  - `agent-s-sdk-step-001.json`

This gives us an offline regression check for the Kaypal-side adapter logic
even before a machine is prepared with the real `gui_agents` package.

### 6. Real on-machine Agent-S readiness check

After installing the real dependencies into the sidecar virtualenv, run:

```bash
/Users/yanghy/Documents/New\ project/kaypal-ai/services/agent-s-executor/.venv/bin/python \
  services/agent-s-executor/scripts/selfcheck_real_agent_s.py
```

This validates:

- `gui_agents` is importable
- `pyautogui` is importable
- `PIL` is importable
- macOS Screen Recording permission is granted
- macOS Accessibility permission is granted
- best-effort screenshot capture works

Interpretation:

- if imports fail, the machine is missing software dependencies
- if imports pass but permission checks fail, the machine is blocked by macOS privacy settings
- if permissions pass but screenshot capture fails, the machine still is not ready for real GUI automation

### 7. Real live Agent-S SDK smoke

Run:

```bash
bash services/agent-s-executor/scripts/smoke-agent-s-sdk-live.sh
```

This validates the true on-machine path:

- macOS permission checks still pass
- a real desktop screenshot can be captured
- `gui_agents.s3` can instantiate `AgentS3` and `OSWorldACI`
- one minimal live `predict(...)` call can complete

If this fails after the permission checks pass, the remaining blocker is
typically model gateway configuration, API key validity, or model compatibility.

### 8. Real sidecar run-path smoke

Run:

```bash
bash services/agent-s-executor/scripts/smoke-agent-s-sdk-sidecar-live.sh
```

This validates the formal sidecar execution path:

- the sidecar boots in `runner_mode=real`
- the sidecar reports `real_provider=agent_s_sdk`
- a real session can be created over HTTP
- a real `/run` can complete
- a real approval-gated `/run` can pause, approve, resume, and complete
- sidecar events include screenshot and completion milestones
- sidecar artifacts include both:
  - the normalized JSON prediction artifact
  - the raw/normalized screenshot artifacts

For the approval-resume slice, the live smoke now also verifies:

- `approval_required` is emitted
- `POST /sessions/{session_id}/approval` accepts `{"decision":"approved"}`
- the resumed session reaches `completed`
- resumed artifacts exist:
  - `external-agent-approval-response.json`
  - `agent-s-sdk-step-002.json`
  - `agent-s-sdk-post-approval.txt`
- full-access execute mode reaches `completed`
- the action execution artifact reports `status=executed`

Important implementation note:

- The cloud-backed live smoke originally failed because the grounding lane did
  not inherit the primary SDK API key and fell back to an unrelated local
  `OPENAI_API_KEY`.
- The provider now defaults the grounding `api_key` to the primary
  `KAYPAL_AGENT_S_SDK_API_KEY` when no dedicated ground key is supplied.
- Execute-mode validation also requires an explicit text whitelist. For the
  current smoke this is `allowed_desktop_text_inputs=["Finder"]`, matching the
  Spotlight `agent.open("Finder")` expansion.

### 9. Real local sidecar live-action smoke

Run:

```bash
bash services/agent-s-executor/scripts/smoke-agent-s-sdk-sidecar-local-live.sh
```

This smoke verifies the controlled-action lane without depending on an external
vision model gateway. It uses:

- the real local desktop permissions
- the real sidecar `/sessions -> /run -> /events -> /artifacts` path
- the real `pyautogui` executor
- a local stub `gui_agents.s3` provider

Then it validates:

- sidecar health in `runner_mode=real`
- `real_provider=agent_s_sdk`
- session creation succeeds
- run acceptance succeeds
- `local_controller_permission_mode=full` reaches `completed`
- expected artifacts are written:
  - `agent-s-sdk-policy-001.json`
  - `agent-s-sdk-action-001.json`
  - `agent-s-sdk-action-execution-001.json`
- the execution artifact reports `status=executed`

Interpretation:

- if this smoke passes, the controlled-action lane is wired correctly on the
  current machine even if remote model credentials are unavailable
- if the cloud-backed live smoke fails but this one passes, the blocker is
  provider auth or model gateway config, not the local action execution path

## Suggested next step after sidecar implementation lands

- pin the canonical port and endpoint contract
- add one deterministic request/response smoke case
- wire the same commands into CI
