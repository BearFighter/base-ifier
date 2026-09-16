import * as Comlink from 'comlink';
import type { KernelApi, ProgressCallback } from './api';

let remote: Comlink.Remote<KernelApi> | null = null;
let worker: Worker | null = null;
let generation = 0;

/** Lazily create the single geometry worker. */
export function kernel(): Comlink.Remote<KernelApi> {
  if (!remote) {
    worker = new Worker(new URL('./kernel.worker.ts', import.meta.url), { type: 'module' });
    remote = Comlink.wrap<KernelApi>(worker);
    generation++;
  }
  return remote;
}

/** Which worker instance is current; changes after `resetKernel()`. */
export function kernelGeneration(): number {
  if (!remote) kernel();
  return generation;
}

/** Kill the worker (e.g. after a hang) so the next `kernel()` call starts a fresh one. */
export function resetKernel(): void {
  if (remote) remote[Comlink.releaseProxy]();
  worker?.terminate();
  worker = null;
  remote = null;
}

/** Wrap a progress callback so it can be passed to the worker. */
export function progressProxy(cb: ProgressCallback): ProgressCallback {
  return Comlink.proxy(cb) as unknown as ProgressCallback;
}

/** Reject if the worker does not answer within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} s and was cancelled`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
