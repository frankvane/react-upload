// 引入 spark-md5
// @ts-expect-error: self.importScripts is not in lib.dom.d.ts
importScripts("https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js");

// 声明SparkMD5类型，避免TS错误
declare global {
  interface Window {
    SparkMD5: {
      ArrayBuffer: new () => {
        append: (buffer: ArrayBuffer) => void;
        end: () => string;
      };
    };
  }
}

self.onmessage = async function (e) {
  const { file, chunkSize } = e.data;
  const total = Math.ceil(file.size / chunkSize);
  const chunkMD5s: string[] = [];
  const fileSpark = new self.SparkMD5.ArrayBuffer();

  // 每处理5个分片报告一次进度，减少消息传递频率
  const PROGRESS_INTERVAL = 5;
  let lastReportedProgress = 0;

  try {
    // 分批处理，每批处理10个分片，避免长时间阻塞
    const BATCH_SIZE = 10;
    for (let batchStart = 0; batchStart < total; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, total);

      // 创建当前批次的所有Promise
      const batchPromises = [];
      for (let i = batchStart; i < batchEnd; i++) {
        const start = i * chunkSize;
        const end = Math.min(file.size, start + chunkSize);
        const chunk = file.slice(start, end);

        // 将每个分片的处理包装成Promise
        const promise = (async (index) => {
          const arrayBuffer = await chunk.arrayBuffer();
          const chunkSpark = new self.SparkMD5.ArrayBuffer();
          chunkSpark.append(arrayBuffer);
          const chunkMD5 = chunkSpark.end();
          return { index, arrayBuffer, chunkMD5 };
        })(i);

        batchPromises.push(promise);
      }

      // 等待当前批次的所有Promise完成
      const results = await Promise.all(batchPromises);

      // 处理结果
      for (const { index, arrayBuffer, chunkMD5 } of results) {
        // 确保按顺序添加到数组
        chunkMD5s[index] = chunkMD5;
        fileSpark.append(arrayBuffer);

        // 报告进度
        const currentProgress = Math.round(((index + 1) / total) * 100);
        if (currentProgress - lastReportedProgress >= PROGRESS_INTERVAL) {
          self.postMessage({
            type: "progress",
            progress: currentProgress,
            processedChunks: index + 1,
            totalChunks: total,
          });
          lastReportedProgress = currentProgress;
        }
      }

      // 每批次完成后让出主线程
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const fileMD5 = fileSpark.end();
    self.postMessage({ type: "complete", fileMD5, chunkMD5s });
  } catch (error: unknown) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : "计算MD5时发生错误",
    });
  }
};
