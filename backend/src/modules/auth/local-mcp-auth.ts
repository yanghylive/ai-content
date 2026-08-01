import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

type LocalMcpAuthFile = {
  version: 1;
  token: string;
  createdAt: string;
};

const LOCAL_MCP_AUTH_FILE_NAME = 'local-mcp-auth.json';

export function getLocalMcpAuthFilePath() {
  const explicit = process.env.KAYPAL_LOCAL_MCP_AUTH_FILE?.trim();
  if (explicit) {
    return explicit;
  }

  const userDataDir = process.env.KAYPAL_DESKTOP_USER_DATA_DIR?.trim();
  if (userDataDir) {
    return join(userDataDir, LOCAL_MCP_AUTH_FILE_NAME);
  }

  return join(process.cwd(), 'data', LOCAL_MCP_AUTH_FILE_NAME);
}

export function ensureLocalMcpAuthToken() {
  const filePath = getLocalMcpAuthFilePath();
  mkdirSync(dirname(filePath), { recursive: true });

  if (existsSync(filePath)) {
    const parsed = JSON.parse(
      readFileSync(filePath, 'utf8'),
    ) as Partial<LocalMcpAuthFile>;
    if (typeof parsed.token === 'string' && parsed.token.trim()) {
      return {
        filePath,
        token: parsed.token.trim(),
      };
    }
  }

  const payload: LocalMcpAuthFile = {
    version: 1,
    token: randomBytes(32).toString('base64url'),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Windows does not use POSIX file modes.
  }
  return {
    filePath,
    token: payload.token,
  };
}
