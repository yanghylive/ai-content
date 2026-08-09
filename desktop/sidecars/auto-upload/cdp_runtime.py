import json
import os
import signal
import socket
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError

from conf import BASE_DIR, LOCAL_CHROME_PATH

CDP_PROFILE_ROOT = BASE_DIR / "browser-profiles"
CDP_LOG_ROOT = BASE_DIR / "logs" / "cdp-runtime"
CDP_PORT_START = int(os.getenv("INTERACTION_CDP_PORT_START", "9223"))
CDP_MAX_PORT_OFFSET = 200
CDP_STARTUP_TIMEOUT_SECONDS = 15
CDP_HEALTH_CHECK_INTERVAL = 0.3
CDP_LAUNCH_STDERR_TAIL_BYTES = 12000


def _find_system_chrome():
    candidates = []
    if LOCAL_CHROME_PATH and str(LOCAL_CHROME_PATH).strip():
        candidates.append(Path(str(LOCAL_CHROME_PATH).strip()).expanduser())
    playwright_roots = []
    playwright_env = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if playwright_env and playwright_env != "0":
        playwright_roots.append(Path(playwright_env).expanduser())
    if sys.platform == "darwin":
        playwright_roots.append(Path.home() / "Library" / "Caches" / "ms-playwright")
    elif sys.platform == "win32":
        playwright_roots.append(Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright")
    else:
        playwright_roots.append(Path.home() / ".cache" / "ms-playwright")
    if sys.platform == "darwin":
        candidates.extend([
            Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
            Path("/Applications/Chromium.app/Contents/MacOS/Chromium"),
        ])
        for root in playwright_roots:
            candidates.extend(sorted(root.glob("chromium-*/chrome-mac-*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"), reverse=True))
    elif sys.platform == "win32":
        for env_key in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
            base = os.environ.get(env_key, "")
            if base:
                candidates.extend([
                    Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe",
                    Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
                ])
        candidates.extend([
            BASE_DIR / "third_party" / "chrome-win" / "chrome.exe",
            BASE_DIR / "third_party" / "chrome" / "chrome.exe",
            BASE_DIR / "third_party" / "edge" / "msedge.exe",
        ])
        for root in playwright_roots:
            candidates.extend(sorted(root.glob("chromium-*/*/chrome.exe"), reverse=True))
    else:
        candidates.extend([
            Path("/usr/bin/google-chrome"),
            Path("/usr/bin/google-chrome-stable"),
            Path("/usr/bin/chromium"),
            Path("/usr/bin/chromium-browser"),
            Path("/snap/bin/chromium"),
        ])
        for root in playwright_roots:
            candidates.extend(sorted(root.glob("chromium-*/chrome-linux/chrome"), reverse=True))
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def _sanitize_profile_part(value):
    cleaned = "".join(ch if ch.isalnum() or ch in ("-", "_") else "-" for ch in str(value or "default"))
    return cleaned.strip("-") or "default"


def profile_dir(platform, account_id):
    return CDP_PROFILE_ROOT / f"{_sanitize_profile_part(platform)}-{_sanitize_profile_part(account_id)}"


def _session_log_path(platform, account_id, suffix="stderr.log"):
    CDP_LOG_ROOT.mkdir(parents=True, exist_ok=True)
    return CDP_LOG_ROOT / f"{_sanitize_profile_part(platform)}-{_sanitize_profile_part(account_id)}.{suffix}"


def _tail_text(path, max_bytes=CDP_LAUNCH_STDERR_TAIL_BYTES):
    try:
        path = Path(path)
        if not path.exists():
            return ""
        with path.open("rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - max_bytes), os.SEEK_SET)
            return fh.read().decode("utf-8", errors="replace").strip()
    except Exception:
        return ""


def _is_port_available(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", int(port))) != 0


def _is_cdp_responding(port):
    try:
        url = f"http://127.0.0.1:{port}/json/version"
        req = Request(url, headers={"Accept": "application/json"})
        with urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return bool(data.get("webSocketDebuggerUrl"))
    except Exception:
        return False


def _get_cdp_profile_dir(port):
    """通过 CDP 端口查询当前浏览器的 user-data-dir（profile 路径）。"""
    try:
        url = f"http://127.0.0.1:{port}/json/version"
        req = Request(url, headers={"Accept": "application/json"})
        with urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("userDataDir") or data.get("user-data-dir") or ""
    except Exception:
        return ""


def _profile_matches(expected_profile, actual_profile):
    if not expected_profile or not actual_profile:
        return False
    expected = str(expected_profile).rstrip("/")
    actual = str(actual_profile).rstrip("/")
    return actual == expected or actual.endswith(expected)


def _port_has_expected_profile_process(port, expected_profile):
    """CDP /json/version may omit userDataDir; verify by browser process args."""
    try:
        expected = str(expected_profile).rstrip("/")
        result = subprocess.run(
            ["ps", "aux"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            return False
        port_arg = f"--remote-debugging-port={int(port)}"
        profile_arg = f"--user-data-dir={expected}"
        for line in result.stdout.splitlines():
            if port_arg in line and profile_arg in line:
                return True
        return False
    except Exception as e:
        print(f"[cdp-runtime] process profile check failed port={port}: {e}")
        return False


def _kill_process_on_port(port):
    """杀掉占用指定端口的进程。"""
    try:
        import subprocess as sp
        if sys.platform == "darwin" or sys.platform.startswith("linux"):
            result = sp.run(
                ["lsof", "-ti", f":{port}"],
                capture_output=True, text=True, timeout=5,
            )
            pids = result.stdout.strip().split("\n")
            for pid in pids:
                pid = pid.strip()
                if pid:
                    try:
                        os.kill(int(pid), signal.SIGTERM)
                    except Exception:
                        pass
            time.sleep(1)
        elif sys.platform == "win32":
            result = sp.run(
                ["netstat", "-ano"],
                capture_output=True, text=True, timeout=5,
            )
            for line in result.stdout.splitlines():
                if f":{port}" in line and "LISTENING" in line:
                    parts = line.split()
                    if parts:
                        try:
                            os.kill(int(parts[-1]), signal.SIGTERM)
                        except Exception:
                            pass
            time.sleep(1)
    except Exception as e:
        print(f"[cdp-runtime] kill process on port {port} failed: {e}")


# 端口分配表：platform:account_id -> 固定端口
_port_assignments = {}


def _deterministic_port(platform, account_id):
    """根据 platform:account_id 生成确定性端口号。
    抖音 ID 1 -> 9223, 抖音 ID 2 -> 9224, 视频号 ID 4 -> 9226 等。
    不同 platform 的同一 account_id 也会映射到不同端口。
    """
    key = f"{_sanitize_profile_part(platform)}:{_sanitize_profile_part(account_id)}"
    h = 0
    for ch in key:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return CDP_PORT_START + (h % CDP_MAX_PORT_OFFSET)


def pick_cdp_port(platform, account_id):
    """为 platform:account_id 分配固定端口。
    优先使用确定性端口，如果被其他 profile 占用则线性探测。
    """
    key = f"{platform}:{account_id}"
    if key in _port_assignments:
        return _port_assignments[key]

    preferred = _deterministic_port(platform, account_id)

    for offset in range(CDP_MAX_PORT_OFFSET):
        port = CDP_PORT_START + ((preferred - CDP_PORT_START + offset) % CDP_MAX_PORT_OFFSET)
        if _is_port_available(port):
            _port_assignments[key] = port
            return port
        cdp_profile = _get_cdp_profile_dir(port)
        expected_profile = str(profile_dir(platform, account_id))
        if _profile_matches(expected_profile, cdp_profile) or _port_has_expected_profile_process(port, expected_profile):
            _port_assignments[key] = port
            return port

    raise RuntimeError(f"没有可用的 CDP 端口给 {key}")


class CdpBrowserSession:
    def __init__(self, platform, account_id, chrome_path=None):
        self.platform = platform
        self.account_id = account_id
        self.profile_path = profile_dir(platform, account_id)
        self.chrome_path = chrome_path or _find_system_chrome()
        self.process = None
        self.cdp_port = None
        self.started_at = None
        self.status = "stopped"
        self.last_error = None
        self.current_url = None
        self._playwright = None
        self._browser = None
        self._context = None
        self._page = None
        self._cdp_client = None
        self._network_trace_enabled = False
        self._network_trace_patterns = []
        self._network_events = []
        self.stderr_path = _session_log_path(platform, account_id)

    def _build_launch_args(self, port):
        return [
            self.chrome_path,
            f"--remote-debugging-port={port}",
            "--remote-debugging-address=127.0.0.1",
            f"--user-data-dir={self.profile_path}",
            "--window-size=1600,1000",
            "--window-position=48,36",
            "--autoplay-policy=no-user-gesture-required",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--disable-features=AutomationControlled",
            "--no-first-run",
            "--no-default-browser-check",
            "--restore-last-session=false",
            "--mute-audio",
            "--lang=zh-CN",
        ]

    def _wait_for_cdp(self, port, timeout=CDP_STARTUP_TIMEOUT_SECONDS):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if _is_cdp_responding(port):
                return True
            time.sleep(CDP_HEALTH_CHECK_INTERVAL)
        return False

    def ensure_running(self, port=None):
        if self.process and self.process.poll() is None and self.cdp_port:
            if _is_cdp_responding(self.cdp_port):
                cdp_profile = _get_cdp_profile_dir(self.cdp_port)
                expected = str(self.profile_path)
                if not cdp_profile or cdp_profile == expected or cdp_profile.rstrip("/").endswith(expected.rstrip("/")):
                    return {
                        "status": "ready",
                        "cdpPort": self.cdp_port,
                        "profileDir": str(self.profile_path),
                        "browser": self.chrome_path,
                        "reused": True,
                        "startedAt": self.started_at,
                    }
                print(f"[cdp-runtime] port {self.cdp_port} profile mismatch: expected={expected}, got={cdp_profile}, restarting on new port")
                self.cdp_port = None
            else:
                print(f"[cdp-runtime] process alive but CDP not responding port={self.cdp_port}, restarting")
            self.stop()

        if not self.chrome_path:
            self.status = "blocked"
            self.last_error = "未找到系统 Chrome/Edge/Chromium 可执行文件"
            raise RuntimeError(self.last_error)

        self.profile_path.mkdir(parents=True, exist_ok=True)

        if port is None:
            port = pick_cdp_port(self.platform, self.account_id)

        if not _is_port_available(port):
            cdp_profile = _get_cdp_profile_dir(port)
            expected = str(self.profile_path)
            if _profile_matches(expected, cdp_profile) or _port_has_expected_profile_process(port, expected):
                self.cdp_port = port
                self.status = "ready"
                self.started_at = datetime.now().isoformat()
                print(f"[cdp-runtime] reusing existing browser on port={port} profile={expected}")
                return {
                    "status": "ready",
                    "cdpPort": port,
                    "profileDir": str(self.profile_path),
                    "browser": self.chrome_path,
                    "reused": True,
                    "startedAt": self.started_at,
                }
            print(f"[cdp-runtime] port {port} occupied by different profile ({cdp_profile or 'unknown'}), finding another port")
            _kill_process_on_port(port)
            time.sleep(1)
            if not _is_port_available(port):
                port = pick_cdp_port(self.platform, self.account_id)
                if not _is_port_available(port):
                    _kill_process_on_port(port)
                    time.sleep(1)

        args = self._build_launch_args(port)
        print(f"[cdp-runtime] launching: {' '.join(args[:3])}... port={port} profile={self.profile_path}")

        try:
            stderr_fh = open(self.stderr_path, "ab")
            self.process = subprocess.Popen(
                args,
                stdout=subprocess.DEVNULL,
                stderr=stderr_fh,
                start_new_session=(sys.platform != "win32"),
            )
            try:
                stderr_fh.close()
            except Exception:
                pass
        except Exception as e:
            self.status = "blocked"
            self.last_error = f"启动浏览器进程失败：{e}"
            raise RuntimeError(self.last_error)

        if not self._wait_for_cdp(port):
            stderr_tail = _tail_text(self.stderr_path)
            self.stop()
            self.status = "blocked"
            self.last_error = f"浏览器启动后 CDP 端口 {port} 未响应（{CDP_STARTUP_TIMEOUT_SECONDS}s 超时）"
            if stderr_tail:
                self.last_error = f"{self.last_error}；Chrome stderr: {stderr_tail[-1200:]}"
            raise RuntimeError(self.last_error)

        self.cdp_port = port
        self.started_at = datetime.now().isoformat()
        self.status = "ready"
        self.last_error = None
        print(f"[cdp-runtime] browser ready port={port} profile={self.profile_path}")

        return {
            "status": "ready",
            "cdpPort": port,
            "profileDir": str(self.profile_path),
            "browser": self.chrome_path,
            "reused": False,
            "startedAt": self.started_at,
        }

    def get_cdp_endpoint(self):
        if not self.cdp_port:
            return None
        return f"http://127.0.0.1:{self.cdp_port}"

    def is_healthy(self):
        # 如果进程存在且已退出，则不健康
        if self.process and self.process.poll() is not None:
            print(f"[cdp-runtime] session unhealthy: process exited")
            return False
        # 如果没有端口，则不健康
        if not self.cdp_port:
            print(f"[cdp-runtime] session unhealthy: no port")
            return False
        # 检查 CDP 是否响应
        responding = _is_cdp_responding(self.cdp_port)
        if not responding:
            print(f"[cdp-runtime] session unhealthy: CDP not responding on port {self.cdp_port}")
        return responding

    def stop(self):
        if self._cdp_client:
            try:
                self._cdp_client = None
            except Exception:
                pass
        self._page = None
        self._context = None
        if self._browser:
            try:
                import asyncio
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.ensure_future(self._browser.close())
                else:
                    loop.run_until_complete(self._browser.close())
            except Exception:
                pass
            self._browser = None
        if self._playwright:
            try:
                import asyncio
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.ensure_future(self._playwright.stop())
                else:
                    loop.run_until_complete(self._playwright.stop())
            except Exception:
                pass
            self._playwright = None
        self._network_trace_enabled = False
        self._network_events = []
        if self.process:
            try:
                if sys.platform == "win32":
                    self.process.terminate()
                else:
                    os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
            except Exception:
                pass
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    self.process.kill()
                except Exception:
                    pass
            self.process = None
        self.cdp_port = None
        self.current_url = None
        self.status = "stopped"

    def to_dict(self):
        if self.cdp_port and _is_cdp_responding(self.cdp_port):
            self.status = "ready"
            self.last_error = None
        return {
            "platform": self.platform,
            "accountId": self.account_id,
            "profileDir": str(self.profile_path),
            "debuggingPort": self.cdp_port,
            "status": self.status,
            "visibleWindow": True,
            "currentUrl": self.current_url,
            "lastError": self.last_error,
            "browser": self.chrome_path,
            "startedAt": self.started_at,
            "stderrPath": str(self.stderr_path),
        }

    async def _ensure_playwright_connected(self):
        if self._page and self._browser:
            try:
                if self._browser.is_connected():
                    _ = self._page.url
                    return
            except Exception:
                pass
            try:
                await self._browser.close()
            except Exception:
                pass
        from playwright.async_api import async_playwright
        if self._playwright is None:
            self._playwright = await async_playwright().start()
        endpoint = self.get_cdp_endpoint()
        if not endpoint:
            raise RuntimeError("CDP endpoint not available")
        self._browser = await self._playwright.chromium.connect_over_cdp(endpoint)
        contexts = self._browser.contexts
        if contexts:
            self._context = contexts[0]
        else:
            self._context = await self._browser.new_context(
                locale="zh-CN",
                timezone_id="Asia/Shanghai",
            )
        self._page = self._context.pages[0] if self._context.pages else await self._context.new_page()

    def ensureSession(self, port=None):
        return self.ensure_running(port)

    async def open(self, url):
        await self._ensure_playwright_connected()
        await self._page.goto(url, wait_until="domcontentloaded", timeout=30000)
        self.current_url = self._page.url
        return self.current_url

    async def click(self, selector_or_point):
        await self._ensure_playwright_connected()
        if isinstance(selector_or_point, dict) and "x" in selector_or_point and "y" in selector_or_point:
            await self._page.mouse.click(selector_or_point["x"], selector_or_point["y"])
        else:
            await self._page.click(selector_or_point)
        self.current_url = self._page.url

    async def type(self, selector_or_point, text):
        await self._ensure_playwright_connected()
        if isinstance(selector_or_point, dict) and "x" in selector_or_point and "y" in selector_or_point:
            await self._page.mouse.click(selector_or_point["x"], selector_or_point["y"])
            await self._page.keyboard.insert_text(text)
        else:
            await self._page.fill(selector_or_point, text)

    async def press(self, key):
        await self._ensure_playwright_connected()
        await self._page.keyboard.press(key)

    async def evaluate(self, script):
        await self._ensure_playwright_connected()
        return await self._page.evaluate(script)

    async def captureScreenshot(self, path=None):
        await self._ensure_playwright_connected()
        if path:
            await self._page.screenshot(path=path)
            return path
        return await self._page.screenshot()

    async def enableNetworkTrace(self, patterns=None):
        await self._ensure_playwright_connected()
        self._network_trace_patterns = patterns or []
        self._network_trace_enabled = True
        self._network_events = []
        if self._cdp_client:
            try:
                await self._cdp_client.detach()
            except Exception:
                pass
            self._cdp_client = None
        try:
            self._cdp_client = await self._context.new_cdp_session(self._page)
            await self._cdp_client.send("Network.enable")

            session_ref = self

            def on_request(params):
                url = params.get("request", {}).get("url", "")
                if session_ref._should_trace(url):
                    session_ref._network_events.append({
                        "kind": "request",
                        "url": url[:500],
                        "method": params.get("request", {}).get("method"),
                        "timestamp": datetime.now().isoformat(),
                    })
                    del session_ref._network_events[:-80]

            def on_response(params):
                url = params.get("response", {}).get("url", "")
                if session_ref._should_trace(url):
                    session_ref._network_events.append({
                        "kind": "response",
                        "url": url[:500],
                        "status": params.get("response", {}).get("status"),
                        "timestamp": datetime.now().isoformat(),
                    })
                    del session_ref._network_events[:-80]

            def on_failed(params):
                url = params.get("request", {}).get("url", "") or params.get("response", {}).get("url", "")
                if session_ref._should_trace(url):
                    session_ref._network_events.append({
                        "kind": "failed",
                        "url": url[:500],
                        "errorText": params.get("errorText"),
                        "timestamp": datetime.now().isoformat(),
                    })
                    del session_ref._network_events[:-80]

            self._cdp_client.on("Network.requestWillBeSent", on_request)
            self._cdp_client.on("Network.responseReceived", on_response)
            self._cdp_client.on("Network.loadingFailed", on_failed)
        except Exception as e:
            print(f"[cdp-runtime] enableNetworkTrace failed: {e}")

    def _should_trace(self, url):
        if not self._network_trace_patterns:
            return True
        lower_url = str(url or "").lower()
        return any(pattern.lower() in lower_url for pattern in self._network_trace_patterns)

    def getNetworkTrace(self):
        return list(self._network_events)


_sessions = {}


def get_session(platform, account_id, chrome_path=None):
    key = f"{platform}:{account_id}"
    session = _sessions.get(key)
    if session and session.is_healthy():
        # 如果会话健康，直接返回，不做 profile 校验（避免误杀正在使用的会话）
        print(f"[cdp-runtime] reusing healthy session {key} on port {session.cdp_port}")
        return session
    if session:
        # 会话不健康，但先检查是否还能用
        if session.cdp_port and _is_cdp_responding(session.cdp_port):
            print(f"[cdp-runtime] session {key} process issue but CDP responding on port {session.cdp_port}, keeping it")
            # 重置进程引用，因为可能进程还活着
            session.process = None  # 让 ensure_running 重新检查
            return session
        print(f"[cdp-runtime] session {key} unhealthy, stopping and recreating")
        session.stop()
    session = CdpBrowserSession(platform, account_id, chrome_path)
    _sessions[key] = session
    print(f"[cdp-runtime] created new session {key}")
    return session


def stop_session(platform, account_id):
    key = f"{platform}:{account_id}"
    session = _sessions.pop(key, None)
    if session:
        session.stop()


def stop_all_sessions():
    for key, session in list(_sessions.items()):
        session.stop()
    _sessions.clear()


def list_sessions():
    return {key: session.to_dict() for key, session in _sessions.items()}
