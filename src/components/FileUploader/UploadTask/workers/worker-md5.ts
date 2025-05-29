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

// 初始化时先发送一个准备就绪的消息
self.postMessage({ type: "ready" });

self.onmessage = async function (e) {
  // 如果没有收到数据，直接返回
  if (!e.data || !e.data.file) {
    self.postMessage({
      type: "error",
      error: "无效的输入数据",
    });
    return;
  }

  const { file, chunkSize } = e.data;

  // 发送开始计算的消息
  self.postMessage({
    type: "progress",
    progress: 0,
    processedChunks: 0,
    totalChunks: 0,
  });

  // 延迟一小段时间再开始计算，避免阻塞UI线程
  await new Promise((resolve) => setTimeout(resolve, 100));

  const total = Math.ceil(file.size / chunkSize);
  const chunkMD5s: string[] = [];
  const fileSpark = new self.SparkMD5.ArrayBuffer();

  // 增加进度报告间隔，减少消息传递频率
  const PROGRESS_INTERVAL = 10; // 每10%报告一次进度
  let lastReportedProgress = 0;

  try {
    // 减小批处理大小，避免长时间阻塞
    const BATCH_SIZE = 5;
    // 批次间隔时间，ms
    const BATCH_INTERVAL = 10;

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

      // 收集结果，但减少状态更新频率
      let shouldReportProgress = false;
      let maxIndex = 0;

      for (const { index, arrayBuffer, chunkMD5 } of results) {
        // 确保按顺序添加到数组
        chunkMD5s[index] = chunkMD5;
        fileSpark.append(arrayBuffer);

        maxIndex = Math.max(maxIndex, index);

        // 检查是否需要报告进度
        const currentProgress = Math.round(((index + 1) / total) * 100);
        if (currentProgress - lastReportedProgress >= PROGRESS_INTERVAL) {
          shouldReportProgress = true;
          lastReportedProgress = currentProgress;
        }
      }

      // 批量报告进度，减少消息传递
      if (shouldReportProgress) {
        self.postMessage({
          type: "progress",
          progress: lastReportedProgress,
          processedChunks: maxIndex + 1,
          totalChunks: total,
        });
      }

      // 每批次完成后让出主线程，增加间隔时间
      await new Promise((resolve) => setTimeout(resolve, BATCH_INTERVAL));
    }

    // 确保最终进度为100%
    if (lastReportedProgress < 100) {
      self.postMessage({
        type: "progress",
        progress: 100,
        processedChunks: total,
        totalChunks: total,
      });
    }

    const fileMD5 = fileSpark.end();

    // 完成后等待一小段时间再发送结果，避免UI阻塞
    await new Promise((resolve) => setTimeout(resolve, 20));

    self.postMessage({ type: "complete", fileMD5, chunkMD5s });
  } catch (error: unknown) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : "计算MD5时发生错误",
    });
  }
};
