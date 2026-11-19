// Path guard: every path argument passes through here before a file is touched (Requirement 3).
// Accepted limit: the check and the later read or write are separate steps. A process that can change the
// file system in between could swap a path for a link. The server is a local tool run by the folder's owner.

import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isNotFound, ToolError } from './errors';

export interface PathGuard {
  root(): Promise<string>;
  resolveExisting(name: string, arg: string): Promise<string>;
  resolveForWrite(name: string, arg: string): Promise<string>;
}

const PARENT = '..';

// Segment-aware: a file called "..notes" is inside, "../tokk-evil" is outside.
function isInside(realRoot: string, candidate: string): boolean {
  const rel = relative(realRoot, candidate);
  return !(isAbsolute(rel) || rel === PARENT || rel.startsWith(PARENT + sep));
}

export function createPathGuard(rootArg: string): PathGuard {
  let cached: Promise<string> | undefined;
  const root = (): Promise<string> => {
    cached ??= realpath(rootArg).catch((e: unknown) => {
      cached = undefined;
      if (isNotFound(e)) throw new ToolError('the working folder of the server does not exist');
      throw e;
    });
    return cached;
  };
  const outside = (name: string, arg: string): ToolError => new ToolError(`${name} is outside the working folder: ${arg}`);

  async function check(name: string, arg: string, candidate: string): Promise<string> {
    if (!isInside(await root(), candidate)) throw outside(name, arg);
    return candidate;
  }

  async function resolveExisting(name: string, arg: string): Promise<string> {
    const realRoot = await root();
    const wanted = await check(name, arg, resolve(realRoot, arg));
    let real: string;
    try {
      real = await realpath(wanted);
    } catch (e) {
      if (isNotFound(e)) throw new ToolError(`not found: ${arg}`);
      throw e;
    }
    return check(name, arg, real);
  }

  async function resolveForWrite(name: string, arg: string): Promise<string> {
    const realRoot = await root();
    const wanted = await check(name, arg, resolve(realRoot, arg));
    try {
      return await check(name, arg, await realpath(wanted));
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    let parent: string;
    try {
      parent = await realpath(dirname(wanted));
    } catch (e) {
      if (isNotFound(e)) throw new ToolError(`parent folder not found: ${arg}`);
      throw e;
    }
    return check(name, arg, join(parent, basename(wanted)));
  }

  return { root, resolveExisting, resolveForWrite };
}