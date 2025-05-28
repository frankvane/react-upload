import mime from "mime";

export function checkFileBeforeUpload({
  file,
  accept,
  maxSizeMB,
  onError,
}: {
  file: File;
  accept: string;
  maxSizeMB: number;
  onError: (msg: string) => void;
}) {
  const acceptList = accept.split(",").map((s) => s.trim().toLowerCase());
  const fileExt = "." + file.name.split(".").pop()?.toLowerCase();
  const fileType = file.type.toLowerCase();
  const typeOk =
    acceptList.includes("*") ||
    acceptList.includes(fileExt) ||
    (acceptList.includes("image/*") && fileType.startsWith("image/"));
  if (!typeOk) {
    onError("文件类型不支持");
    return false;
  }
  if (file.size > maxSizeMB * 1024 * 1024) {
    onError(`文件不能超过${maxSizeMB}MB`);
    return false;
  }
  return true;
}

export function createFileChunks(file: File, chunkSize: number) {
  const chunks = [];
  let cur = 0;
  while (cur < file.size) {
    chunks.push({
      index: chunks.length,
      start: cur,
      end: Math.min(cur + chunkSize, file.size),
      chunk: file.slice(cur, cur + chunkSize),
    });
    cur += chunkSize;
  }
  return chunks;
}

export function calcFileMD5WithWorker(
  file: File,
  chunkSize: number
): Promise<{ fileMD5: string; chunkMD5s: string[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../workers/worker-md5.js", import.meta.url)
    );
    worker.postMessage({ file, chunkSize });
    worker.onmessage = (e) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = (err) => {
      reject(err);
      worker.terminate();
    };
  });
}

export function appendSpeedHistory(
  history: Array<{ time: number; loaded: number }>,
  time: number,
  loaded: number,
  windowSize: number
) {
  const newHistory = [...history, { time, loaded }];
  if (newHistory.length > windowSize) newHistory.shift();
  return newHistory;
}

export function calcSpeedAndLeftTime(
  history: Array<{ time: number; loaded: number }>,
  fileSize: number
) {
  if (history.length < 2) return { speed: 0, leftTime: 0 };
  const first = history[0];
  const last = history[history.length - 1];
  const speed =
    (last.loaded - first.loaded) / ((last.time - first.time) / 1000);
  const leftBytes = fileSize - last.loaded;
  const leftTime = speed > 0 ? leftBytes / speed : 0;
  return { speed, leftTime };
}

export function calcTotalSpeed(
  speedInfo: Record<string, { speed: number; leftTime: number }>
) {
  return Object.values(speedInfo).reduce((sum, s) => sum + (s.speed || 0), 0);
}

export function ByteConvert(size: number): string {
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(2) + " KB";
  if (size < 1024 * 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + " MB";
  return (size / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

export function checkFileTypeSafe(file: File, allowedTypes: string[]): boolean {
  const extMime = mime.getType(file.name) || "";
  return allowedTypes.includes(file.type) && allowedTypes.includes(extMime);
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
