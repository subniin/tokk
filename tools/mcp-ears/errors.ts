// Error texts for tool results. No stack, no samples, no resolved paths.

// An error whose message is already written for the caller.
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

interface ErrnoLike { code: string; syscall?: string }

function isErrno(e: unknown): e is Error & ErrnoLike {
  return e instanceof Error && typeof (e as { code?: unknown }).code === 'string' && /^E[A-Z0-9]+$/.test((e as unknown as ErrnoLike).code);
}

export function isNotFound(e: unknown): boolean {
  return isErrno(e) && e.code === 'ENOENT';
}

// Runs `fn`. A missing file or folder becomes "not found: <arg as given>", in the caller's words.
export async function withArg<T>(arg: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isNotFound(e)) throw new ToolError(`not found: ${arg}`);
    throw e;
  }
}

export function toToolError(error: unknown): string {
  if (isErrno(error)) {
    // Node file system messages carry the resolved path, so only the code is kept.
    return `file system error ${error.code}${error.syscall ? ` (${error.syscall})` : ''}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}