import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type BuildInfo = {
  builtAt: string | null;
  commit: string | null;
};

export type HealthPayload = {
  ok: true;
  message: string;
  build: BuildInfo;
};

export function readBuildInfo(): BuildInfo {
  const path = join(__dirname, '..', 'build-info.json');

  if (!existsSync(path)) {
    return {
      builtAt: null,
      commit: null,
    };
  }

  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BuildInfo>;

    return {
      builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : null,
      commit: typeof parsed.commit === 'string' ? parsed.commit : null,
    };
  } catch {
    return {
      builtAt: null,
      commit: null,
    };
  }
}

function shortCommit(commit: string | null): string {
  if (!commit || commit === 'unknown') return 'desconhecido';
  return commit.slice(0, 7);
}

export function getHealthPayload(): HealthPayload {
  const build = readBuildInfo();

  if (!build.builtAt) {
    return {
      ok: true,
      message:
        'API online — ATENÇÃO: build sem metadados (provável deploy antigo; dist/ não recompilado).',
      build,
    };
  }

  const commitLabel = shortCommit(build.commit);

  return {
    ok: true,
    message: `API online — commit ${commitLabel} compilado em ${build.builtAt}.`,
    build,
  };
}
