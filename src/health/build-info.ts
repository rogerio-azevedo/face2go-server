import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type BuildInfo = {
  builtAt: string | null;
  commit: string | null;
  deployMarker: string | null;
  routesVerified?: string[];
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
      deployMarker: null,
    };
  }

  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BuildInfo>;

    return {
      builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : null,
      commit: typeof parsed.commit === 'string' ? parsed.commit : null,
      deployMarker:
        typeof parsed.deployMarker === 'string' ? parsed.deployMarker : null,
      routesVerified: Array.isArray(parsed.routesVerified)
        ? parsed.routesVerified
        : undefined,
    };
  } catch {
    return {
      builtAt: null,
      commit: null,
      deployMarker: null,
    };
  }
}

function shortCommit(commit: string | null): string {
  if (!commit || commit === 'unknown') return 'desconhecido';
  return commit.slice(0, 7);
}

export function getHealthPayload(): HealthPayload {
  const build = readBuildInfo();

  if (!build.builtAt || !build.deployMarker) {
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
    message: `API online — deploy "${build.deployMarker}" compilado em ${build.builtAt} (commit ${commitLabel}).`,
    build,
  };
}
