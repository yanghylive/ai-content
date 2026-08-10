#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT_ROOT="$(cd "${EXTENSION_ROOT}/../.." && pwd)"
RECIPE_DIR="${HOME}/.config/goose/recipes"
RECIPE_PATH="${RECIPE_DIR}/kaypal-ai-content-operator.yaml"
NODE_BIN="${KAYPAL_AI_CONTENT_NODE_BIN:-$(command -v node)}"
SERVER_PATH="${EXTENSION_ROOT}/dist/index.js"

if [ ! -x "${NODE_BIN}" ]; then
  echo "node not found. Set KAYPAL_AI_CONTENT_NODE_BIN to a Node >=20 binary." >&2
  exit 1
fi

if [ ! -f "${SERVER_PATH}" ]; then
  echo "MCP server not built: ${SERVER_PATH}" >&2
  echo "Run: npm --prefix \"${EXTENSION_ROOT}\" install && npm --prefix \"${EXTENSION_ROOT}\" run build" >&2
  exit 1
fi

mkdir -p "${RECIPE_DIR}"

cat > "${RECIPE_PATH}" <<YAML
version: "1.0.0"
title: "Kaypal AI Content 本机工作台"
description: "通过 Goose MCP 连接本机 Kaypal AI Content 3010/3011，检查运行状态、账号、互动记录，并打开常用工作台页面。"
parameters:
  - key: page
    input_type: string
    requirement: optional
    default: "run_check"
    description: "可选页面：accounts、run_check、douyin_comments、douyin_messages、channel_comments、channel_messages"
  - key: seed
    input_type: string
    requirement: optional
    default: "本地生活内容选题"
    description: "可选智能挖题关键词或事件描述"
instructions: |
  你是 Kaypal AI Content 的本机操作助手。
  如果用户要打开 Goose 应用入口，调用 kaypal_ai_content_open_app。
  开始任何操作前，先调用 kaypal_ai_content_health_check 确认 3011、MCP、Agent-S 和登录态。
  如果 3010/3011 未启动，可以在用户明确要求后调用 kaypal_ai_content_local_services action=start confirm=true。
  优先使用只读工具读取状态、记录、账号和运行检查。
  不要直接发布、发送、删除外部平台内容；需要外部动作时先打开对应页面，让用户确认。
  智能挖题、文章生成、打开互动入口等会消耗资源或启动浏览器的工具，必须在用户明确要求后传 confirm=true。
  如果私有接口返回未登录，提示用户先在 Kaypal AI Content 桌面应用里完成登录；跨进程授权 Cookie 只作为手动高级配置，不写入 recipe。
activities:
  - "message: **Kaypal AI Content 本机工作台**\n\n先检查本机 3011、运行检查、账号状态，再决定下一步动作。"
  - "检查 Kaypal AI Content 运行状态"
  - "打开 {{ page }} 对应的 Kaypal AI Content 页面"
  - "查看平台账号登录态"
  - "查看抖音评论或私信记录"
  - "查看视频号评论或私信记录"
  - "围绕 {{ seed }} 做智能挖题"
extensions:
  - type: stdio
    name: kaypal-ai-content-mcp
    cmd: "${NODE_BIN}"
    args:
      - "${SERVER_PATH}"
    envs:
      KAYPAL_AI_CONTENT_API_BASE: "http://127.0.0.1:3011/api"
      KAYPAL_AI_CONTENT_FRONTEND_BASE: "http://127.0.0.1:3010"
      KAYPAL_AI_CONTENT_ROOT: "${PROJECT_ROOT}"
      KAYPAL_AI_CONTENT_LOCAL_MCP_AUTH_FILE: "${PROJECT_ROOT}/backend/data/local-mcp-auth.json"
    timeout: 90
    description: "Kaypal AI Content MCP Extension for local 3010/3011 status, account, task, record and content-generation tools"
    available_tools:
      - kaypal_ai_content_open_app
      - kaypal_ai_content_local_services
      - kaypal_ai_content_health_check
      - kaypal_ai_content_open_page
      - kaypal_ai_content_account_status
      - kaypal_ai_content_kaypal_profile
      - kaypal_ai_content_runtime_status
      - kaypal_ai_content_list_tasks
      - kaypal_ai_content_list_records
      - kaypal_ai_content_generate_reply
      - kaypal_ai_content_open_interaction_entry
      - kaypal_ai_content_discover_topics
      - kaypal_ai_content_generate_article
YAML

echo "Installed Goose recipe:"
echo "${RECIPE_PATH}"
echo
echo "Recipe server:"
echo "${NODE_BIN} ${SERVER_PATH}"
