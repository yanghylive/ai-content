"""
Kaypal MCP Client for Agent-S · 让 Agent-S (17777) 通过 MCP 调浏览器

架构:
  Agent-S LLM 生成 action (e.g. browser_navigate)
  -> Agent-S executor 解析 action type
  -> KaypalMcpClient.call_tool('browser_navigate', {url: ...})
  -> POST /api/mcp/playwright (NestJS backend)
  -> playwright-mcp sidecar
  -> Chrome

替代方案: 用 pyautogui 直接控制 OS. 现在通过 MCP, 一处实现 Chrome 自动化,
Agent-S 不用关心 OS 差异.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class McpClientConfig:
    endpoint: str
    timeout_seconds: int


def load_mcp_config() -> McpClientConfig:
    endpoint = os.getenv("KAYPAL_MCP_PLAYWRIGHT_URL", "http://127.0.0.1:3011/api/mcp/playwright").strip()
    timeout = int(os.getenv("KAYPAL_MCP_TIMEOUT_SECONDS", "30").strip() or "30")
    return McpClientConfig(endpoint=endpoint, timeout_seconds=timeout)


class KaypalMcpClient:
    """
    极简 MCP 客户端: 用 stdlib urllib (Agent-S 没装 requests/httpx).
    支持 initialize / tools/list / tools/call.
    """

    def __init__(self, config: Optional[McpClientConfig] = None) -> None:
        self.config = config or load_mcp_config()
        self._next_id = 1
        self._initialized = False

    def _next_request_id(self) -> int:
        rid = self._next_id
        self._next_id += 1
        return rid

    def _post_json(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url=self.config.endpoint,
            data=body,
            method="POST",
            headers={
                "content-type": "application/json",
                "accept": "application/json, text/event-stream",
            },
        )
        try:
            with urllib.request.urlopen(
                request,
                timeout=self.config.timeout_seconds,
            ) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"MCP HTTP {exc.code}: {raw}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"MCP unreachable: {exc}") from exc

        # 响应可能是 SSE (event: message\ndata: {...}) 或纯 JSON
        if raw.startswith("event:"):
            for line in raw.split("\n"):
                if line.startswith("data:"):
                    return json.loads(line[len("data:"):].strip())
            raise RuntimeError(f"MCP SSE response without data: {raw[:200]}")
        return json.loads(raw) if raw else {}

    def initialize(self) -> None:
        if self._initialized:
            return
        result = self._post_json({
            "jsonrpc": "2.0",
            "id": self._next_request_id(),
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "kaypal-agent-s", "version": "0.1.0"},
            },
        })
        if "error" in result:
            raise RuntimeError(f"MCP initialize failed: {result['error']}")
        logger.info(f"kaypal-mcp initialized: {result.get('result', {}).get('serverInfo', {})}")
        self._initialized = True

    def list_tools(self) -> List[Dict[str, Any]]:
        self.initialize()
        result = self._post_json({
            "jsonrpc": "2.0",
            "id": self._next_request_id(),
            "method": "tools/list",
            "params": {},
        })
        if "error" in result:
            raise RuntimeError(f"MCP tools/list failed: {result['error']}")
        return result.get("result", {}).get("tools", [])

    def call_tool(self, name: str, arguments: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        self.initialize()
        result = self._post_json({
            "jsonrpc": "2.0",
            "id": self._next_request_id(),
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments or {}},
        })
        if "error" in result:
            raise RuntimeError(f"MCP tools/call {name} failed: {result['error']}")
        return result.get("result", {})

    def health(self) -> bool:
        try:
            tools = self.list_tools()
            return len(tools) > 0
        except Exception as exc:
            logger.debug(f"kaypal-mcp health check failed: {exc}")
            return False


_singleton: Optional[KaypalMcpClient] = None


def get_mcp_client() -> KaypalMcpClient:
    """单例 - 整个 Agent-S 进程共用一个 MCP 连接"""
    global _singleton
    if _singleton is None:
        _singleton = KaypalMcpClient()
    return _singleton
