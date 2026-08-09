from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


SessionStatus = Literal[
    "idle",
    "running",
    "waiting_approval",
    "completed",
    "failed",
    "cancelled",
]

ArtifactKind = Literal["screenshot", "json", "text", "summary", "log"]


class ErrorResponse(BaseModel):
    detail: str


class CreateSessionRequest(BaseModel):
    session_name: Optional[str] = None
    task_type: str = "desktop.gui.visual.mock"
    metadata: Dict[str, Any] = Field(default_factory=dict)
    labels: List[str] = Field(default_factory=list)


class RunSessionRequest(BaseModel):
    instruction: str = Field(min_length=1)
    task_type: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    risk_level: Literal["low", "medium", "high"] = "medium"
    requires_approval: bool = False
    step_count: Optional[int] = Field(default=None, ge=1, le=10)
    mock_step_delay_ms: Optional[int] = Field(default=None, ge=0, le=60000)
    simulate_failure_step: Optional[int] = Field(default=None, ge=1, le=10)


class SessionArtifact(BaseModel):
    artifact_id: str
    session_id: str
    run_id: Optional[str] = None
    kind: ArtifactKind
    filename: str
    path: str
    created_at: str
    size_bytes: int
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SessionEvent(BaseModel):
    seq: int
    session_id: str
    run_id: Optional[str] = None
    event_type: str
    status: SessionStatus
    created_at: str
    message: Optional[str] = None
    step_index: Optional[int] = None
    artifact_id: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)


class SessionSummary(BaseModel):
    session_id: str
    session_name: Optional[str] = None
    task_type: str
    status: SessionStatus
    created_at: str
    updated_at: str
    completed_at: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    labels: List[str] = Field(default_factory=list)
    run_count: int = 0
    active_run_id: Optional[str] = None
    cancellation_requested: bool = False
    last_error: Optional[str] = None
    last_event_seq: int = 0
    artifact_count: int = 0


class HealthResponse(BaseModel):
    status: str
    service: str
    host: str
    port: int
    runner_mode: str
    real_provider: Optional[str] = None
    session_count: int
    running_session_count: int
    artifact_root: str
    auth_header: str


class StatusResponse(BaseModel):
    state: Literal["idle", "running", "stopping"]
    service: str
    version: str
    pid: int
    runner_mode: str
    real_provider: Optional[str] = None
    session_count: int
    running_session_count: int
    artifact_root: str
    mcp: Optional[dict] = None  # 2026-06-04: playwright-mcp 集成状态


class StopResponse(BaseModel):
    status: Literal["stopping"]


class CreateSessionResponse(BaseModel):
    session: SessionSummary


class RunAcceptedResponse(BaseModel):
    accepted: bool = True
    session_id: str
    run_id: str
    status: SessionStatus


class SessionEventsResponse(BaseModel):
    session_id: str
    after_seq: int = 0
    next_seq: int = 0
    events: List[SessionEvent] = Field(default_factory=list)


class CancelSessionResponse(BaseModel):
    session_id: str
    status: SessionStatus
    cancellation_requested: bool


class SessionArtifactsResponse(BaseModel):
    session_id: str
    artifacts: List[SessionArtifact] = Field(default_factory=list)


class SessionApprovalDecisionRequest(BaseModel):
    decision: Literal["approved", "rejected"]
    comment: Optional[str] = None


class SessionApprovalDecisionResponse(BaseModel):
    session_id: str
    status: SessionStatus
    decision: Literal["approved", "rejected"]
