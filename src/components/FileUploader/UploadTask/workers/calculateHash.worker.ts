/* eslint-disable no-restricted-globals */
// 在非模块类型的 Worker 中使用 importScripts
// @ts-expect-error - importScripts 在 TypeScript 中没有类型定义
importScripts("https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js");

// 处理文件并计算文件和分块的MD5
self.onmessage = function (e: MessageEvent) {
  const { file, chunkSize } = e.data;

  if (!file) {
    self.postMessage({
      type: "error",
      error: "没有提供文件",
    });
    return;
  }

  const chunks = Math.ceil(file.size / chunkSize);
  let currentChunk = 0;
  // @ts-expect-error - SparkMD5 是通过 importScripts 导入的
  const spark = new SparkMD5.ArrayBuffer();
  // @ts-expect-error - SparkMD5 是通过 importScripts 导入的
  const chunkSparks = Array(chunks)
    .fill(0)
    .map(() => new SparkMD5.ArrayBuffer());
  const chunkHashes: string[] = Array(chunks).fill("");
  const fileReader = new FileReader();

  fileReader.onload = function (e) {
    if (e.target?.result) {
      const arrayBuffer = e.target.result as ArrayBuffer;

      // 更新整体文件哈希
      spark.append(arrayBuffer);

      // 更新当前分片哈希
      chunkSparks[currentChunk].append(arrayBuffer);
      chunkHashes[currentChunk] = chunkSparks[currentChunk].end();

      // 报告进度
      self.postMessage({
        type: "progress",
        progress: Math.round(((currentChunk + 1) / chunks) * 100),
        currentChunk,
        totalChunks: chunks,
      });

      currentChunk++;

      if (currentChunk < chunks) {
        loadNext();
      } else {
        // 计算完成
        self.postMessage({
          type: "complete",
          fileHash: spark.end(),
          chunkHashes: chunkHashes,
        });
      }
    }
  };

  fileReader.onerror = function () {
    self.postMessage({
      type: "error",
      error: "文件读取错误",
    });
  };

  function loadNext() {
    const start = currentChunk * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    fileReader.readAsArrayBuffer(file.slice(start, end));
  }

  loadNext();
};
