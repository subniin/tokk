import workerSource from 'tokk:worker-source';

export interface WorkerHandle {
  worker: Worker;
  dispose(): void;
}

const WORKER_MIME_TYPE = 'text/javascript';

// Starts a Worker from source text through a Blob URL, so it works from a CDN across origins.
// Blob, URL and Worker are touched only when this function is called.
export function createWorkerFromSource(source: string): WorkerHandle {
  const url = URL.createObjectURL(new Blob([source], { type: WORKER_MIME_TYPE }));
  const worker = new Worker(url);
  return {
    worker,
    dispose() {
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };
}

export function createTokkWorker(): WorkerHandle {
  return createWorkerFromSource(workerSource);
}
