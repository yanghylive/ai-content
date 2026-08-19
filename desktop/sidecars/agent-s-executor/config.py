from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


BASE_DIR = Path(__file__).resolve().parent


RunnerMode = Literal["mock", "real"]
RealProvider = Literal["external_http", "agent_s_sdk"]


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    auth_token: str
    artifact_root: Path
    mock_step_delay_ms: int
    default_step_count: int
    runner_mode: RunnerMode
    real_provider: RealProvider
    external_agent_base_url: str
    external_agent_api_key: str
    external_agent_timeout_ms: int
    agent_s_sdk_model_provider: str
    agent_s_sdk_model: str
    agent_s_sdk_base_url: str
    agent_s_sdk_api_key: str
    agent_s_sdk_platform: str
    agent_s_sdk_max_steps: int
    agent_s_sdk_execute_actions: bool
    agent_s_sdk_action_space: str
    agent_s_sdk_observation_type: str
    agent_s_sdk_search_engine: str
    agent_s_sdk_ground_provider: str
    agent_s_sdk_ground_url: str
    agent_s_sdk_ground_model: str
    agent_s_sdk_ground_api_key: str
    agent_s_sdk_grounding_width: int
    agent_s_sdk_grounding_height: int


def _read_int(name: str, default: int) -> int:
    value = os.getenv(name, str(default)).strip()
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {value!r}") from exc


def _read_runner_mode(name: str, default: RunnerMode) -> RunnerMode:
    value = os.getenv(name, default).strip().lower()
    if value not in {"mock", "real"}:
        raise ValueError(f"{name} must be 'mock' or 'real', got {value!r}")
    return value  # type: ignore[return-value]


def _read_real_provider(name: str, default: RealProvider) -> RealProvider:
    value = os.getenv(name, default).strip().lower()
    if value not in {"external_http", "agent_s_sdk"}:
        raise ValueError(
            f"{name} must be 'external_http' or 'agent_s_sdk', got {value!r}"
        )
    return value  # type: ignore[return-value]


def _read_bool(name: str, default: bool) -> bool:
    value = os.getenv(name, "1" if default else "0").strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean, got {value!r}")


def load_settings() -> Settings:
    artifact_root = os.getenv(
        "KAYPAL_AGENT_S_ARTIFACT_ROOT",
        str(BASE_DIR / "data"),
    ).strip()
    return Settings(
        host=os.getenv("KAYPAL_AGENT_S_HOST", "127.0.0.1").strip() or "127.0.0.1",
        port=_read_int("KAYPAL_AGENT_S_PORT", 17777),
        auth_token=os.getenv("KAYPAL_AGENT_S_TOKEN", "").strip()
        or "",
        artifact_root=Path(artifact_root).expanduser().resolve(),
        mock_step_delay_ms=max(0, _read_int("KAYPAL_AGENT_S_MOCK_STEP_DELAY_MS", 250)),
        default_step_count=max(1, _read_int("KAYPAL_AGENT_S_DEFAULT_STEP_COUNT", 3)),
        runner_mode=_read_runner_mode("KAYPAL_AGENT_S_RUNNER_MODE", "mock"),
        real_provider=_read_real_provider(
            "KAYPAL_AGENT_S_REAL_PROVIDER",
            "external_http",
        ),
        external_agent_base_url=os.getenv("KAYPAL_AGENT_S_EXTERNAL_AGENT_BASE_URL", "").strip(),
        external_agent_api_key=os.getenv("KAYPAL_AGENT_S_EXTERNAL_AGENT_API_KEY", "").strip(),
        external_agent_timeout_ms=max(
            1000,
            _read_int("KAYPAL_AGENT_S_EXTERNAL_AGENT_TIMEOUT_MS", 30000),
        ),
        agent_s_sdk_model_provider=os.getenv(
            "KAYPAL_AGENT_S_SDK_MODEL_PROVIDER",
            "openai",
        ).strip()
        or "openai",
        agent_s_sdk_model=os.getenv("KAYPAL_AGENT_S_SDK_MODEL", "gpt-4o").strip() or "gpt-4o",
        agent_s_sdk_base_url=os.getenv("KAYPAL_AGENT_S_SDK_BASE_URL", "").strip(),
        agent_s_sdk_api_key=os.getenv("KAYPAL_AGENT_S_SDK_API_KEY", "").strip(),
        agent_s_sdk_platform=os.getenv("KAYPAL_AGENT_S_SDK_PLATFORM", "").strip(),
        agent_s_sdk_max_steps=max(
            1,
            _read_int("KAYPAL_AGENT_S_SDK_MAX_STEPS", 3),
        ),
        agent_s_sdk_execute_actions=_read_bool(
            "KAYPAL_AGENT_S_SDK_EXECUTE_ACTIONS",
            False,
        ),
        agent_s_sdk_action_space=os.getenv(
            "KAYPAL_AGENT_S_SDK_ACTION_SPACE",
            "pyautogui",
        ).strip()
        or "pyautogui",
        agent_s_sdk_observation_type=os.getenv(
            "KAYPAL_AGENT_S_SDK_OBSERVATION_TYPE",
            "mixed",
        ).strip()
        or "mixed",
        agent_s_sdk_search_engine=os.getenv(
            "KAYPAL_AGENT_S_SDK_SEARCH_ENGINE",
            "",
        ).strip(),
        agent_s_sdk_ground_provider=os.getenv(
            "KAYPAL_AGENT_S_SDK_GROUND_PROVIDER",
            "",
        ).strip(),
        agent_s_sdk_ground_url=os.getenv(
            "KAYPAL_AGENT_S_SDK_GROUND_URL",
            "",
        ).strip(),
        agent_s_sdk_ground_model=os.getenv(
            "KAYPAL_AGENT_S_SDK_GROUND_MODEL",
            "",
        ).strip(),
        agent_s_sdk_ground_api_key=os.getenv(
            "KAYPAL_AGENT_S_SDK_GROUND_API_KEY",
            "",
        ).strip(),
        agent_s_sdk_grounding_width=max(
            1,
            _read_int("KAYPAL_AGENT_S_SDK_GROUNDING_WIDTH", 1920),
        ),
        agent_s_sdk_grounding_height=max(
            1,
            _read_int("KAYPAL_AGENT_S_SDK_GROUNDING_HEIGHT", 1080),
        ),
    )
