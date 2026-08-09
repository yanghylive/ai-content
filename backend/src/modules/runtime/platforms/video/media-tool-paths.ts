import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type MediaToolName = 'ffmpeg' | 'ffprobe';

function executableName(tool: MediaToolName) {
  return process.platform === 'win32' ? `${tool}.exe` : tool;
}

export function resolveMediaToolPath(tool: MediaToolName) {
  const envKey =
    tool === 'ffmpeg' ? 'KAYPAL_FFMPEG_PATH' : 'KAYPAL_FFPROBE_PATH';
  const explicitPath = `${process.env[envKey] || ''}`.trim();
  if (explicitPath) return explicitPath;

  if (process.env.KAYPAL_BUNDLED_MEDIA_TOOLS_REQUIRED === '1') {
    throw new Error(
      `${envKey} is required when bundled media tools are enforced`,
    );
  }

  const name = executableName(tool);
  const candidates = [
    join(process.cwd(), '..', 'media-tools', 'bin', name),
    join(process.cwd(), 'media-tools', 'bin', name),
    join(process.cwd(), '..', 'desktop', 'runtime', 'media-tools', 'bin', name),
  ];
  const bundledPath = candidates.find((candidate) => existsSync(candidate));
  if (bundledPath) return bundledPath;

  return name;
}
