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

  // 输出调试信息
  console.log(
    `[Worker] 开始计算文件MD5: ${file.name}, 大小: ${file.size} 字节, 分片大小: ${chunkSize} 字节`
  );

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
    const BATCH_SIZE = 3; // 减小批处理大小到3，降低处理压力
    // 批次间隔时间，ms
    const BATCH_INTERVAL = 20; // 增加批处理间隔，给主线程更多恢复时间

    console.log(
      `[Worker] 开始计算MD5，总分片数: ${total}, 批处理大小: ${BATCH_SIZE}`
    );

    // 存储所有成功处理的分片结果
    const processedChunks = new Map();

    // 循环处理每个批次
    for (let batchStart = 0; batchStart < total; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, total);
      console.log(`[Worker] 处理批次 ${batchStart}-${batchEnd - 1}`);

      // 创建当前批次的所有Promise
      const batchPromises = [];
      for (let i = batchStart; i < batchEnd; i++) {
        const start = i * chunkSize;
        const end = Math.min(file.size, start + chunkSize);
        const chunk = file.slice(start, end);

        // 将每个分片的处理包装成Promise
        const promise = (async (index) => {
          try {
            // 增加日志记录，跟踪每个分片的处理
            console.log(
              `[Worker] 开始处理分片 ${index}, 大小: ${end - start} 字节`
            );
            const arrayBuffer = await chunk.arrayBuffer();

            // 验证arrayBuffer是否有效
            if (!arrayBuffer || arrayBuffer.byteLength === 0) {
              console.error(`[Worker] 分片 ${index} 的arrayBuffer无效`);
              throw new Error(`分片 ${index} 的arrayBuffer无效`);
            }

            const chunkSpark = new self.SparkMD5.ArrayBuffer();
            chunkSpark.append(arrayBuffer);
            const chunkMD5 = chunkSpark.end();
            console.log(
              `[Worker] 分片 ${index} MD5计算成功: ${chunkMD5.substring(
                0,
                8
              )}...`
            );

            return { index, arrayBuffer, chunkMD5 };
          } catch (err) {
            console.error(`[Worker] 分片 ${index} 处理失败:`, err);
            throw err; // 重新抛出错误，不再静默失败
          }
        })(i);

        batchPromises.push(promise);
      }

      try {
        // 等待当前批次的所有Promise完成
        const results = await Promise.all(batchPromises);

        // 处理成功的结果
        for (const { index, arrayBuffer, chunkMD5 } of results) {
          // 存储处理结果
          processedChunks.set(index, { arrayBuffer, chunkMD5 });
          // 确保按顺序添加到数组
          chunkMD5s[index] = chunkMD5;
        }

        // 检查是否需要报告进度
        const currentProgress = Math.round(
          (Math.min(batchEnd, total) / total) * 100
        );
        if (
          currentProgress - lastReportedProgress >= PROGRESS_INTERVAL ||
          batchEnd === total
        ) {
          lastReportedProgress = currentProgress;
          self.postMessage({
            type: "progress",
            progress: currentProgress,
            processedChunks: batchEnd,
            totalChunks: total,
          });
          console.log(
            `[Worker] 进度报告: ${currentProgress}%, 已处理: ${batchEnd}/${total}`
          );
        }
      } catch (err) {
        console.error(
          `[Worker] 批次 ${batchStart}-${batchEnd - 1} 处理失败:`,
          err
        );
        // 重试当前批次，但使用更小的批处理大小
        if (BATCH_SIZE > 1) {
          console.log(
            `[Worker] 尝试对批次 ${batchStart}-${batchEnd - 1} 进行单个分片处理`
          );
          // 回退处理位置，使用单个分片处理
          batchStart = batchStart - BATCH_SIZE + 1;
          continue;
        } else {
          throw err; // 如果单个分片处理仍然失败，则抛出错误
        }
      }

      // 每批次完成后让出主线程，增加间隔时间
      await new Promise((resolve) => setTimeout(resolve, BATCH_INTERVAL));
    }

    // 按顺序将所有arrayBuffer添加到fileSpark
    console.log(`[Worker] 所有分片处理完成，开始计算整体MD5...`);
    for (let i = 0; i < total; i++) {
      const data = processedChunks.get(i);
      if (!data) {
        console.error(`[Worker] 缺少分片 ${i} 的处理结果`);
        throw new Error(`缺少分片 ${i} 的处理结果`);
      }

      try {
        fileSpark.append(data.arrayBuffer);
      } catch (err) {
        console.error(`[Worker] 添加分片 ${i} 到文件MD5计算失败:`, err);
        throw err;
      }
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

    // 计算整体MD5
    const fileMD5 = fileSpark.end();
    console.log(`[Worker] 文件MD5计算成功: ${fileMD5}`);

    // 完成后等待一小段时间再发送结果，避免UI阻塞
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 发送结果前再次检查数据完整性
    if (!fileMD5 || !chunkMD5s.length) {
      console.error(
        `[Worker] 计算结果不完整: fileMD5=${fileMD5}, chunkMD5s长度=${chunkMD5s.length}`
      );
      throw new Error("MD5计算结果不完整");
    }

    console.log(
      `[Worker] 发送计算结果: fileMD5=${fileMD5}, chunkMD5s长度=${chunkMD5s.length}`
    );
    self.postMessage({
      type: "complete",
      fileMD5,
      chunkMD5s,
    });
    console.log(`[Worker] 计算完成消息已发送`);
  } catch (error: unknown) {
    console.error("[Worker] MD5计算过程中发生错误:", error);
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : "计算MD5时发生错误",
    });
  }
};
