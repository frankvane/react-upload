// 文件worker调度服务，支持3个worker并发

import type { UploadFileMeta } from "../types/file";

const WORKER_COUNT = 3;
const workers: Worker[] = [];
const idleWorkers: Worker[] = [];
const taskQueue: Array<{
  file: File;
  resolve: (meta: UploadFileMeta) => void;
  reject: (err: any) => void;
}> = [];

function createWorker(): Worker {
  // @ts-ignore
  const worker = new Worker(
    new URL("../workers/fileToArrayBuffer.worker.ts", import.meta.url)
  );
  worker.onmessage = (e) => {
    const { success, data, error } = e.data;
    const task = (worker as any)._currentTask;
    (worker as any)._currentTask = null;
    idleWorkers.push(worker);
    if (task) {
      if (success) task.resolve(data);
      else task.reject(error);
    }
    runNext();
  };
  return worker;
}

function runNext() {
  if (taskQueue.length === 0 || idleWorkers.length === 0) return;
  const worker = idleWorkers.shift()!;
  const task = taskQueue.shift()!;
  (worker as any)._currentTask = task;
  worker.postMessage({ file: task.file });
}

export function fileToArrayBufferWithWorker(
  file: File
): Promise<UploadFileMeta> {
  return new Promise((resolve, reject) => {
    taskQueue.push({ file, resolve, reject });
    runNext();
  });
}

// 初始化worker池
if (workers.length === 0) {
  for (let i = 0; i < WORKER_COUNT; i++) {
    const w = createWorker();
    workers.push(w);
    idleWorkers.push(w);
  }
}
