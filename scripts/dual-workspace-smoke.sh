#!/usr/bin/env bash
# ============================================================================
# 双工作区（3010 业务 + 8088 Octop 高级模式）本机三端冒烟脚本
# ----------------------------------------------------------------------------
# 作用：在「本机已跑 Octop 8088（launchd 托管）+ 后端 3011 + 前端 3010」前提下，
#       脚本化验证双工作区集成（对应 2026-08-24 审计 #1/#2/#3/#5/#6），
#       并给出需要人工在 Electron 里点验的 GUI 验收清单。
#
# 用法：
#   bash scripts/dual-workspace-smoke.sh                  # 静态校验 + 三端健康检查
#   bash scripts/dual-workspace-smoke.sh --build         # 额外：重打桌面包 + check:package-contents（复验 #1）
#   bash scripts/dual-workspace-smoke.sh --start         # 额外：后台拉起 backend(3011)+frontend(3010)
#   bash scripts/dual-workspace-smoke.sh --build --start # 全量
#
# 环境变量：
#   SESSION_COOKIE  已登录用户 session cookie（用于 /api/octop/launch 鉴权检查；缺省跳过该项）
#   FRONTEND_PORT   前端端口（默认 3010，需与桌面业务标签目标一致）
#   BACKEND_PORT    后端端口（默认 3011）
#   OCTOP_PORT      Octop 端口（默认 8088）
#   OCTOP_BASE      后端读取的 Octop 地址（默认 http://127.0.0.1:${OCTOP_PORT}）
#
# 说明：真实 Electron 窗口内的标签交互（点「＋ Octop 高级模式」→ 免登录加载 8088）
#       无法脚本化，须在桌面端人工点验；本脚本只做 HTTP/打包层可脚本化验证。
# ============================================================================

# 注：刻意不用 `set -u`。macOS 自带 /bin/bash 3.2 在「命令替换赋值 + elif 分支内把该变量以双引号参数传入函数」组合下，
# 会误报 "unbound variable"（已知老 bash bug）。该脚本为开发冒烟工具，去掉 -u 比踩坑更稳妥。
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESK="$ROOT/desktop"
BACK="$ROOT/backend"
FRONT="$ROOT/frontend"

FRONTEND_PORT="${FRONTEND_PORT:-3010}"
BACKEND_PORT="${BACKEND_PORT:-3011}"
OCTOP_PORT="${OCTOP_PORT:-8088}"
OCTOP_BASE="${OCTOP_BASE:-http://127.0.0.1:${OCTOP_PORT}}"
DO_BUILD=0; DO_START=0
for a in "$@"; do case "$a" in --build) DO_BUILD=1;; --start) DO_START=1;; esac; done

PASS=(); FAIL=()
report(){ if [ "$2" = "ok" ]; then PASS+=("$1"); echo "  [OK] $1"; else FAIL+=("$1"); echo "  [FAIL] $1"; fi; }
health(){ # $1 url
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$1" 2>/dev/null || echo "000")
  # 端口可达即算活（401/403 说明服务在跑只是需鉴权）；只有 000 才算不可达
  if [ "$code" = "000" ]; then return 1; else return 0; fi
}

echo "================================================================"
echo " 双工作区三端冒烟  ·  $(date '+%F %T')"
echo " 前端 ${FRONTEND_PORT} · 后端 ${BACKEND_PORT} · Octop ${OCTOP_BASE}"
echo "================================================================"

# ---------------------------------------------------------------------------
# 阶段 1：#1 静态校验 —— main.js 的 require 均被 package.json build.files 收录
# （无需打包装即可发现漏收文件导致的启动崩溃，是 check:package-contents 的轻量等价版）
# ---------------------------------------------------------------------------
echo; echo "【阶段1】#1 打包完整性静态校验（main.js require <-> package.json files）"
if [ -f "$DESK/main.js" ] && [ -f "$DESK/package.json" ]; then
  reqs=$(grep -oE "require\(['\"]\.[^'\"]+['\"]\)" "$DESK/main.js" | sed -E "s/require\(['\"]//; s/['\"]\)//; s/\.js$//; s|^\./||" | sort -u)
  files=$(node -e "const f=require('$DESK/package.json').build.files; console.log(Array.isArray(f)?f.join('\n'):'')")
  missing=0
  while IFS= read -r r; do
    [ -z "$r" ] && continue
    echo "$files" | grep -qx "$r.js" || echo "$files" | grep -qx "$r" || { echo "    漏收: $r"; missing=1; }
  done <<< "$reqs"
  if [ "$missing" = "0" ]; then report "main.js 本地依赖全部被 build.files 收录（#1 静态通过）" ok; else report "#1 仍漏收文件（见上）" fail; fi
else
  report "desktop/main.js 或 package.json 缺失" fail
fi

# ---------------------------------------------------------------------------
# 阶段 2（--build）：真打桌面包 + check:package-contents（#1 真实验证）
# ---------------------------------------------------------------------------
if [ "$DO_BUILD" = "1" ]; then
  echo; echo "【阶段2】重打桌面包 + check:package-contents（#1 真实验证，较重）"
  cd "$DESK" || { report "无法进入 desktop 目录" fail; }
  if npm run build:mac >/tmp/dw-build.log 2>&1; then
    report "桌面 Mac 包构建成功" ok
    if npm run check:package-contents >/tmp/dw-pkg.log 2>&1; then
      report "check:package-contents 全过（#1 真实修复已验证）" ok
    else
      report "check:package-contents 失败（见 /tmp/dw-pkg.log）" fail
    fi
  else
    report "桌面 Mac 包构建失败（见 /tmp/dw-build.log）" fail
  fi
fi

# ---------------------------------------------------------------------------
# 阶段 3（--start）：后台拉起 backend + frontend
# ---------------------------------------------------------------------------
PIDS=()
cleanup(){ [ ${#PIDS[@]} -gt 0 ] && kill "${PIDS[@]}" 2>/dev/null; }
trap cleanup EXIT
if [ "$DO_START" = "1" ]; then
  echo; echo "【阶段3】后台拉起 backend(3011) + frontend($FRONTEND_PORT)"
  (cd "$BACK" && npm run start:dev >/tmp/dw-backend.log 2>&1 & echo $! >/tmp/dw-backend.pid)
  PIDS+=("$(cat /tmp/dw-backend.pid)")
  (cd "$FRONT" && PORT="$FRONTEND_PORT" npm run dev >/tmp/dw-frontend.log 2>&1 & echo $! >/tmp/dw-frontend.pid)
  PIDS+=("$(cat /tmp/dw-frontend.pid)")
  echo "   等待服务就绪…"
  for i in $(seq 1 30); do
    curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$BACKEND_PORT/api/health" && break
    sleep 1
  done
  for i in $(seq 1 30); do
    curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$FRONTEND_PORT/" && break
    sleep 1
  done
fi

# ---------------------------------------------------------------------------
# 阶段 4：三端健康检查
# ---------------------------------------------------------------------------
echo; echo "【阶段4】三端健康检查"
if health "http://127.0.0.1:$OCTOP_PORT/api/health"; then report "Octop 8088 存活（GET /api/health）" ok; else report "Octop 8088 不可达（确认 launchd 已拉起本机 Octop）" fail; fi
if health "http://127.0.0.1:$BACKEND_PORT/api/health"; then report "后端 3011 存活" ok; else report "后端 3011 不可达（未启动时加 --start）" fail; fi
if health "http://127.0.0.1:$FRONTEND_PORT/"; then report "前端 $FRONTEND_PORT 存活" ok; else report "前端 $FRONTEND_PORT 不可达（未启动时加 --start）" fail; fi

# ---------------------------------------------------------------------------
# 阶段 5：/api/octop/launch 路由校验（无 cookie 也应 401=已注册受护，而非 404=陈旧编译产物）
# ---------------------------------------------------------------------------
echo; echo "【阶段5】GET /api/octop/launch 路由校验"
UC=$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 "http://127.0.0.1:$BACKEND_PORT/api/octop/launch")
if [ "$UC" = "404" ]; then
  report "/api/octop/launch 返回 404 -> 路由未注册（后端是陈旧编译产物，需重载 3011 加载 0f8c85fd）" fail
elif [ "$UC" = "401" ] || [ "$UC" = "403" ]; then
  report "/api/octop/launch 已注册且受保护（无 cookie 返 $UC）" ok
else
  report "/api/octop/launch 无 cookie 返 $UC（非预期状态码）" fail
fi

# 若提供已登录 session cookie，进一步校验返回形态 {octopBaseUrl, healthy, token}
if [ -n "${SESSION_COOKIE:-}" ]; then
  resp=$(curl -s --max-time 6 -H "Cookie: $SESSION_COOKIE" "http://127.0.0.1:$BACKEND_PORT/api/octop/launch")
  if echo "$resp" | grep -qE "octopBaseUrl" && echo "$resp" | grep -qE "healthy" && echo "$resp" | grep -qE "token"; then
    healthy=$(echo "$resp" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).healthy)}catch(e){console.log('parse-error')}})")
    report "后端返回 {octopBaseUrl, healthy, token}（healthy=$healthy）" ok
    if [ "$healthy" = "true" ]; then report "Octop 探活成功（后端能联通 8088）" ok; else report "Octop 探活失败（healthy=false，检查 8088 是否真的在跑）" fail; fi
  else
    report "/api/octop/launch 返回形态异常：$resp" fail
  fi
else
  echo "  [SKIP] 未提供 SESSION_COOKIE，跳过 /api/octop/launch 鉴权形态检查（人工验收时在桌面点「＋ Octop 高级模式」验证）"
fi

# ---------------------------------------------------------------------------
# 阶段 6：人工 GUI 验收清单（Electron 桌面端）
# ---------------------------------------------------------------------------
echo; echo "【阶段6】需人工在 Electron 桌面端点验（无法脚本化）"
echo "  [ ] 启动后固定「业务工作区」标签加载 3010 且不可关闭（#5）"
echo "  [ ] 顶部「＋ Octop 高级模式」点击 -> 开 octop 标签加载 8088 且免登录（#2/#3 SSO）"
echo "  [ ] DevTools Network 看 Octop 请求带 Authorization: Bearer <kda_ token>（#3 免登录注入）"
echo "  [ ] 尝试关闭业务标签被拒 / 关最后自动重建（#5/#6）"

# ---------------------------------------------------------------------------
echo; echo "================================================================"
if [ ${#FAIL[@]} -eq 0 ]; then echo " 冒烟结论：无失败项（脚本可验部分全过；GUI 项见阶段6人工验收）"; else echo " 冒烟结论：${#FAIL[@]} 项失败："; printf '   - %s\n' "${FAIL[@]}"; fi
echo "================================================================"
exit ${#FAIL[@]}
