import * as api from "./api";
import * as dbService from "./dbService";

import PQueue from "p-queue";
import React from "react";
import SparkMD5 from "spark-md5";
import type { UploadFileMeta } from "../types/file";
import { UploadStatus } from "../types/upload";
import { message } from "antd";
import pRetry from "p-retry";
import { useNetworkType } from "../hooks/useNetworkType";
import { useUploadStore } from "../store/uploadStore";

// 默认分片大小：2MB
const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024;

// API 请求前缀
const API_PREFIX = "http://localhost:3000/api";

// 创建动态并发数的队列，默认并发数为3
const uploadQueue = new PQueue({ concurrency: 3, autoStart: true });

// 添加详细的日志记录来追踪队列处理流程
uploadQueue.on("active", () => {
  console.log(
    `[队列事件] 任务开始执行 - 队列长度:${uploadQueue.size}, 等待中:${uploadQueue.pending}`
  );
});

uploadQueue.on("idle", () => {
  console.log("[队列事件] 队列空闲，所有任务已完成");
});

uploadQueue.on("add", () => {
  console.log(
    `[队列事件] 任务已添加 - 队列长度:${uploadQueue.size}, 等待中:${uploadQueue.pending}`
  );
});

uploadQueue.on("next", () => {
  console.log(`[队列事件] 开始下一个任务 - 剩余队列长度:${uploadQueue.size}`);
});

uploadQueue.on("error", (error) => {
  console.error("[队列事件] 队列任务执行错误:", error);
});

uploadQueue.on("completed", () => {
  console.log("[队列事件] 任务完成，准备执行下一个");
});

// 存储每个文件的中断控制器
const fileAbortControllers: Record<string, AbortController> = {};

// 更新队列并发数
export const updateQueueConcurrency = (concurrency: number) => {
  // 确保 concurrency 至少为 1，防止 p-queue 抛出错误
  const safeValue = Math.max(1, concurrency);

  if (uploadQueue.concurrency !== safeValue) {
    console.log(
      `[上传配置] 更新队列并发数: ${uploadQueue.concurrency} -> ${safeValue}`
    );
    uploadQueue.concurrency = safeValue;
  }
};

// 使用Worker计算文件哈希和分片哈希
export const calculateFileHashWithWorker = async (
  fileId: string,
  file: File
): Promise<{
  fileHash: string;
  chunkHashes: string[];
}> => {
  const { updateFileStatus } = useUploadStore.getState();

  // 尝试从 IndexedDB 获取该文件的元数据，获取已保存的切片大小
  let chunkSize = DEFAULT_CHUNK_SIZE; // 默认分片大小
  try {
    const fileMeta = await dbService.getFileMeta(fileId);
    if (fileMeta && fileMeta.chunkSize) {
      chunkSize = fileMeta.chunkSize;
      console.log(
        `使用 IndexedDB 中保存的切片大小: ${chunkSize / (1024 * 1024)}MB`
      );
    }
  } catch (err) {
    console.warn("无法从 IndexedDB 获取文件元数据，使用默认切片大小", err);
  }

  return new Promise((resolve, reject) => {
    try {
      const worker = new Worker(
        new URL("../workers/calculateHash.worker.ts", import.meta.url)
      );

      worker.onmessage = (e) => {
        const data = e.data;

        if (data.type === "progress") {
          // 更新UI中的计算进度
          updateFileStatus(fileId, UploadStatus.CALCULATING, data.progress);
        } else if (data.type === "complete") {
          // 计算完成
          resolve({
            fileHash: data.fileHash,
            chunkHashes: data.chunkHashes,
          });
          worker.terminate();
        } else if (data.type === "error") {
          // 处理错误
          reject(new Error(data.error));
          worker.terminate();
        }
      };

      worker.onerror = (err) => {
        reject(err);
        worker.terminate();
      };

      // 发送文件和分块大小到Worker
      worker.postMessage({
        file,
        chunkSize: chunkSize, // 使用从 IndexedDB 获取的或默认的切片大小
      });
    } catch (err) {
      reject(new Error(`创建Worker失败: ${err}`));
    }
  });
};

// 计算文件哈希和分片哈希
export const calculateFileHash = async (
  file: File
): Promise<{
  fileHash: string;
  chunkHashes: string[];
}> => {
  return new Promise((resolve, reject) => {
    const chunkSize = DEFAULT_CHUNK_SIZE;
    const chunks = Math.ceil(file.size / chunkSize);
    let currentChunk = 0;
    const spark = new SparkMD5.ArrayBuffer();
    const chunkSparks = Array(chunks)
      .fill(0)
      .map(() => new SparkMD5.ArrayBuffer());
    const chunkHashes: string[] = Array(chunks).fill("");
    const fileReader = new FileReader();

    fileReader.onload = (e) => {
      if (e.target?.result) {
        const arrayBuffer = e.target.result as ArrayBuffer;

        // 更新整体文件哈希
        // @ts-expect-error - spark-md5 类型定义与实际使用不匹配
        spark.append(arrayBuffer);

        // 更新当前分片哈希
        // @ts-expect-error - spark-md5 类型定义与实际使用不匹配
        chunkSparks[currentChunk].append(arrayBuffer);
        chunkHashes[currentChunk] = chunkSparks[currentChunk].end();

        currentChunk++;

        if (currentChunk < chunks) {
          loadNext();
        } else {
          const fileHash = spark.end();
          resolve({ fileHash, chunkHashes });
        }
      }
    };

    fileReader.onerror = (error) => {
      reject(error);
    };

    function loadNext() {
      const start = currentChunk * chunkSize;
      const end =
        start + chunkSize >= file.size ? file.size : start + chunkSize;
      fileReader.readAsArrayBuffer(file.slice(start, end));
    }

    loadNext();
  });
};

// 保存文件元数据到 IndexedDB
export const saveFileToIndexedDB = async (
  file: File,
  fileId: string,
  chunkSize: number
): Promise<boolean> => {
  try {
    // 先计算文件的 MD5 哈希
    const { fileHash } = await calculateFileHashWithWorker(fileId, file);

    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = async (event) => {
        if (event.target?.result) {
          const buffer = event.target.result as ArrayBuffer;
          const meta: UploadFileMeta = {
            key: fileHash, // 使用 MD5 哈希作为 key，而不是 fileId
            name: file.name,
            buffer,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            addedAt: Date.now(),
            chunkSize,
          };

          const result = await dbService.saveFileMeta(meta);
          resolve(result);
        } else {
          reject(new Error("读取文件失败"));
        }
      };

      reader.onerror = (error) => {
        reject(error);
      };

      reader.readAsArrayBuffer(file);
    });
  } catch (error) {
    console.error("保存文件到IndexedDB失败:", error);
    return false;
  }
};

// 从 IndexedDB 获取文件元数据
export const getFileFromIndexedDB = async (
  fileId: string
): Promise<UploadFileMeta | null> => {
  return dbService.getFileMeta(fileId);
};

// 检查文件是否可以秒传
export const checkInstantUpload = async (
  fileId: string,
  fileHash: string,
  fileName: string,
  fileSize: number,
  chunkCount: number,
  chunkHashes: string[]
): Promise<{
  uploaded: boolean;
  chunkCheckResult: Array<{ index: number; exist: boolean; match: boolean }>;
}> => {
  try {
    return await api.checkInstantUpload(
      {
        fileId,
        md5: fileHash,
        name: fileName,
        size: fileSize,
        total: chunkCount,
        chunkMD5s: chunkHashes,
      },
      { apiPrefix: API_PREFIX }
    );
  } catch (error) {
    console.error("检查秒传失败:", error);
    return {
      uploaded: false,
      chunkCheckResult: Array(chunkCount)
        .fill(0)
        .map((_, index) => ({
          index,
          exist: false,
          match: false,
        })),
    };
  }
};

// 上传文件分片
export const uploadFileChunk = async (
  fileId: string,
  file: File,
  chunkIndex: number,
  chunkSize: number,
  chunkHash: string,
  totalChunks: number,
  abortSignal?: AbortSignal
): Promise<boolean> => {
  try {
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);

    const result = await api.uploadFileChunk(
      {
        fileId,
        chunk_md5: chunkHash,
        index: chunkIndex,
        chunk,
        name: file.name,
        total: totalChunks,
      },
      {
        apiPrefix: API_PREFIX,
        signal: abortSignal,
      }
    );

    return result.code === 200;
  } catch (error) {
    // 如果是因为中断导致的错误，不需要抛出
    if (error instanceof Error && error.name === "AbortError") {
      console.log(`分片 ${chunkIndex} 上传已中断`);
      return false;
    }
    console.error(`上传分片 ${chunkIndex} 失败:`, error);
    throw error;
  }
};

// 上传文件分片（带自动重试）
export const uploadFileChunkWithRetry = async (
  fileId: string,
  file: File,
  chunkIndex: number,
  chunkSize: number,
  chunkHash: string,
  totalChunks: number,
  abortSignal?: AbortSignal
): Promise<boolean> => {
  return pRetry(
    async () => {
      return await uploadFileChunk(
        fileId,
        file,
        chunkIndex,
        chunkSize,
        chunkHash,
        totalChunks,
        abortSignal
      );
    },
    {
      retries: 3,
      onFailedAttempt: (error) => {
        console.warn(
          `分片[${chunkIndex}]上传失败，正在重试: 第${error.attemptNumber}次，还剩${error.retriesLeft}次`,
          error
        );
      },
    }
  );
};

// 合并文件分片
export const mergeFileChunks = async (
  fileId: string,
  fileHash: string,
  fileName: string,
  fileSize: number,
  chunkCount: number
): Promise<string> => {
  try {
    const result = await api.mergeFile(
      {
        fileId,
        md5: fileHash,
        name: fileName,
        size: fileSize,
        total: chunkCount,
      },
      { apiPrefix: API_PREFIX }
    );

    if (result.code !== 200) {
      throw new Error(result.message || "合并文件失败");
    }

    return result.data.url;
  } catch (error) {
    console.error("合并文件失败:", error);
    throw error;
  }
};

// 处理文件上传
export const processFileUpload = async (fileId: string): Promise<void> => {
  const {
    uploadFiles,
    updateFileStatus,
    updateFileHash,
    updateFileChunks,
    incrementUploadedChunks,
    updatePausedChunks,
    setErrorMessage,
  } = useUploadStore.getState();

  // 查找要处理的文件
  const uploadFile = uploadFiles.find((uf) => uf.id === fileId);
  if (!uploadFile) {
    console.error(`[上传错误] 文件ID ${fileId} 未找到，无法上传`);
    return;
  }

  console.log(
    `[上传开始] 处理文件: ${uploadFile.file.name}, 状态: ${uploadFile.status}`
  );

  // 如果文件不是等待上传状态，则重置为等待上传状态
  if (
    uploadFile.status !== UploadStatus.QUEUED_FOR_UPLOAD &&
    uploadFile.status !== UploadStatus.QUEUED &&
    uploadFile.status !== UploadStatus.PAUSED
  ) {
    console.log(
      `[上传警告] 文件 ${uploadFile.file.name} 状态不是等待上传 (${uploadFile.status})`
    );
    return;
  }

  try {
    // 更新状态为计算哈希中
    updateFileStatus(fileId, UploadStatus.CALCULATING, 0);
    console.log(`[上传进度] 文件 ${uploadFile.file.name} 开始计算哈希`);

    // 尝试从 IndexedDB 获取文件元数据，包括预先保存的切片大小
    let savedChunkSize: number | undefined;
    try {
      const fileMeta = await dbService.getFileMeta(fileId);
      if (fileMeta && fileMeta.chunkSize) {
        savedChunkSize = fileMeta.chunkSize;
        console.log(
          `[上传配置] 从 IndexedDB 获取到的文件 ${fileId} 切片大小: ${
            savedChunkSize / (1024 * 1024)
          }MB`
        );
      }
    } catch (err) {
      console.warn(
        `[上传警告] 无法从 IndexedDB 获取文件 ${fileId} 元数据`,
        err
      );
    }

    // 使用 Worker 计算文件哈希和分片哈希
    const { fileHash, chunkHashes } = await calculateFileHashWithWorker(
      fileId,
      uploadFile.file
    );
    console.log(
      `[上传进度] 文件 ${
        uploadFile.file.name
      } 哈希计算完成: ${fileHash.substring(0, 8)}...`
    );

    // 更新哈希值
    updateFileHash(fileId, fileHash);

    // 准备上传
    updateFileStatus(fileId, UploadStatus.PREPARING_UPLOAD, 0);
    console.log(`[上传进度] 文件 ${uploadFile.file.name} 准备上传`);

    // 检查是否可以秒传
    const fileName = uploadFile.file.name;
    const fileSize = uploadFile.file.size;
    const chunkSize = savedChunkSize || DEFAULT_CHUNK_SIZE; // 使用保存的切片大小或默认值
    const chunkCount = Math.ceil(fileSize / chunkSize);

    console.log(
      `[上传配置] 文件 ${fileName} 大小: ${fileSize} 字节, 切片大小: ${chunkSize} 字节, 切片数: ${chunkCount}`
    );

    // 更新文件分片信息
    updateFileChunks(fileId, chunkSize, chunkCount);

    // 检查文件是否已存在，是否可以秒传
    console.log(`[上传进度] 检查文件 ${fileName} 是否可以秒传`);
    const checkResult = await checkInstantUpload(
      fileId,
      fileHash,
      fileName,
      fileSize,
      chunkCount,
      chunkHashes
    );

    if (checkResult.uploaded) {
      // 文件已存在，可以秒传
      updateFileStatus(fileId, UploadStatus.INSTANT, 100);
      console.log(`[上传完成] 文件 ${fileName} 秒传成功`);
      return;
    }

    // 如果不能秒传，开始正常上传流程
    updateFileStatus(fileId, UploadStatus.UPLOADING, 0);
    console.log(`[上传进度] 文件 ${fileName} 开始上传`);

    // 获取已经上传的分片索引
    const uploadedChunks = checkResult.chunkCheckResult
      .filter((result) => result.exist && result.match)
      .map((result) => result.index);

    console.log(
      `[上传进度] 文件 ${fileName} 已上传的分片数量: ${uploadedChunks.length}`
    );

    // 更新暂停时已上传的分片索引
    updatePausedChunks(fileId, uploadedChunks);

    // 创建中断控制器
    const abortController = new AbortController();
    fileAbortControllers[fileId] = abortController;

    // 计算需要上传的分片
    const chunksToUpload = Array.from({ length: chunkCount })
      .map((_, index) => index)
      .filter((index) => !uploadedChunks.includes(index));

    console.log(
      `[上传进度] 文件 ${fileName} 共 ${chunkCount} 个分片，已上传 ${uploadedChunks.length} 个，需要上传 ${chunksToUpload.length} 个`
    );

    // 如果所有分片都已上传，直接合并
    if (chunksToUpload.length === 0) {
      console.log(`[上传进度] 文件 ${fileName} 所有分片已上传，直接合并`);
      try {
        await mergeFileChunks(fileId, fileHash, fileName, fileSize, chunkCount);
        updateFileStatus(fileId, UploadStatus.DONE, 100);
        console.log(`[上传完成] 文件 ${fileName} 合并成功`);

        // 清理 IndexedDB 中的文件元数据
        try {
          await dbService.removeFileMeta(fileHash);
          console.log(
            `[缓存清理] 文件 ${fileName} (哈希: ${fileHash.substring(
              0,
              8
            )}...) 的元数据已从 IndexedDB 中移除`
          );
        } catch (cleanupError) {
          console.warn(
            `[缓存警告] 清理文件 ${fileName} 元数据失败:`,
            cleanupError
          );
        }
      } catch (error: any) {
        console.error(`[上传错误] 合并文件 ${fileName} 失败:`, error);
        setErrorMessage(fileId, `合并失败: ${error.message}`);
        updateFileStatus(fileId, UploadStatus.ERROR, 0);
      }
      return;
    }

    // 分片上传
    let successCount = 0;
    let isAborted = false;

    // 创建 PQueue 用于限制并发上传的分片数
    // 使用当前文件保存的 chunkSize 计算适合的并发数
    const chunkConcurrency = getOptimalConcurrency(chunkSize);
    console.log(
      `[上传配置] 文件 ${fileName} 使用分片并发数: ${chunkConcurrency}`
    );

    const chunkQueue = new PQueue({ concurrency: chunkConcurrency });

    // 监听中断信号
    abortController.signal.addEventListener("abort", () => {
      isAborted = true;
      chunkQueue.clear();
      console.log(`[上传中断] 文件 ${fileName} 上传已中断`);
    });

    // 启动所有分片的上传任务
    try {
      await Promise.allSettled(
        chunksToUpload.map((chunkIndex) =>
          chunkQueue.add(async () => {
            if (isAborted) return;

            try {
              // 上传分片
              console.log(
                `[上传分片] 文件 ${fileName} 上传分片 ${chunkIndex}/${
                  chunkCount - 1
                }`
              );
              const chunkUploadResult = await uploadFileChunkWithRetry(
                fileId,
                uploadFile.file,
                chunkIndex,
                chunkSize,
                chunkHashes[chunkIndex],
                chunkCount,
                abortController.signal
              );

              if (chunkUploadResult) {
                successCount++;
                incrementUploadedChunks(fileId);
                console.log(
                  `[上传分片] 文件 ${fileName} 分片 ${chunkIndex} 上传成功，已完成 ${successCount}/${chunksToUpload.length}`
                );

                // 检查所有分片是否已上传完成
                if (successCount === chunksToUpload.length) {
                  try {
                    console.log(
                      `[上传进度] 文件 ${fileName} 所有分片上传完成，开始合并`
                    );
                    await mergeFileChunks(
                      fileId,
                      fileHash,
                      fileName,
                      fileSize,
                      chunkCount
                    );
                    updateFileStatus(fileId, UploadStatus.DONE, 100);
                    console.log(`[上传完成] 文件 ${fileName} 上传和合并成功`);

                    // 清理 IndexedDB 中的文件元数据
                    try {
                      await dbService.removeFileMeta(fileHash);
                      console.log(
                        `[缓存清理] 文件 ${fileName} (哈希: ${fileHash.substring(
                          0,
                          8
                        )}...) 的元数据已从 IndexedDB 中移除`
                      );
                    } catch (cleanupError) {
                      console.warn(
                        `[缓存警告] 清理文件 ${fileName} 元数据失败:`,
                        cleanupError
                      );
                    }
                  } catch (error: any) {
                    console.error(
                      `[上传错误] 合并文件 ${fileName} 失败:`,
                      error
                    );
                    setErrorMessage(fileId, `合并失败: ${error.message}`);
                    updateFileStatus(fileId, UploadStatus.ERROR, 0);
                  }
                }
              } else {
                console.warn(
                  `[上传警告] 文件 ${fileName} 分片 ${chunkIndex} 上传失败`
                );
              }
            } catch (error: any) {
              if (error.name === "AbortError") {
                console.log(
                  `[上传中断] 文件 ${fileName} 分片 ${chunkIndex} 上传已中断`
                );
              } else {
                console.error(
                  `[上传错误] 上传文件 ${fileName} 分片 ${chunkIndex} 失败:`,
                  error
                );
                // 仅在非中断错误时更新状态
                if (!isAborted) {
                  setErrorMessage(
                    fileId,
                    `上传分片 ${chunkIndex} 失败: ${error.message}`
                  );
                  updateFileStatus(fileId, UploadStatus.ERROR, 0);
                  abortController.abort();
                }
              }
            }
          })
        )
      );
    } catch (uploadError) {
      console.error(`[上传错误] 上传过程发生异常:`, uploadError);
      if (!isAborted) {
        setErrorMessage(fileId, `上传异常: ${uploadError}`);
        updateFileStatus(fileId, UploadStatus.ERROR, 0);
      }
    }

    // 清除已完成或取消的中断控制器
    delete fileAbortControllers[fileId];
    console.log(
      `[上传结束] 文件 ${fileName} 处理完成，状态: ${
        useUploadStore.getState().uploadFiles.find((f) => f.id === fileId)
          ?.status
      }`
    );
  } catch (error: any) {
    console.error(
      `[上传错误] 处理文件 ${uploadFile.file.name} 上传失败:`,
      error
    );
    setErrorMessage(fileId, error.message);
    updateFileStatus(fileId, UploadStatus.ERROR, 0);

    // 清除中断控制器
    delete fileAbortControllers[fileId];
  }

  // 确保函数有明确的返回，不会卡住Promise
  return Promise.resolve();
};

// 根据分片大小获取最优并发数
const getOptimalConcurrency = (chunkSize: number): number => {
  // 根据分片大小动态调整并发数
  // 分片越小，并发数越高；分片越大，并发数越低
  if (chunkSize >= 8 * 1024 * 1024) return 2; // 8MB以上，并发数为2
  if (chunkSize >= 4 * 1024 * 1024) return 3; // 4MB以上，并发数为3
  if (chunkSize >= 2 * 1024 * 1024) return 4; // 2MB以上，并发数为4
  if (chunkSize >= 1 * 1024 * 1024) return 5; // 1MB以上，并发数为5
  return 6; // 小于1MB，并发数为6
};

// 将文件添加到上传队列
export const addFileToQueue = (
  fileId: string,
  priority = 0,
  concurrency?: number
): void => {
  const { uploadFiles, updateFileStatus } = useUploadStore.getState();

  // 查找文件
  const file = uploadFiles.find((f) => f.id === fileId);
  if (!file) {
    console.error(`[上传错误] 无法将文件添加到队列，文件ID不存在: ${fileId}`);
    return;
  }

  // 记录当前文件状态
  console.log(
    `[队列操作] 准备将文件添加到上传队列: ${file.file.name}, 当前状态: ${file.status}, 优先级: ${priority}`
  );

  // 如果文件已经在队列中或已完成，则不再添加
  if (
    file.status !== UploadStatus.QUEUED_FOR_UPLOAD &&
    file.status !== UploadStatus.ERROR &&
    file.status !== UploadStatus.MERGE_ERROR &&
    file.status !== UploadStatus.PAUSED
  ) {
    console.log(
      `[队列操作] 文件 ${file.file.name} 已在队列中或已完成，不再添加`
    );
    return;
  }

  // 如果提供了并发数，则更新队列并发数
  if (concurrency !== undefined) {
    updateQueueConcurrency(concurrency);
  }

  // 更新文件状态为 QUEUED（已进入队列）
  updateFileStatus(fileId, UploadStatus.QUEUED);

  // 使用更健壮的方式添加任务到队列，确保任务执行完成后不会卡住
  uploadQueue
    .add(
      async () => {
        console.log(
          `[队列操作] 开始处理队列中的文件: ${file.file.name}, 优先级: ${priority}`
        );
        try {
          await processFileUpload(fileId).catch((err) => {
            console.error(
              `[队列错误] 处理文件 ${file.file.name} 时发生错误:`,
              err
            );
            // 确保即使有错误也能继续处理队列
            return Promise.resolve();
          });
          console.log(`[队列操作] 文件 ${file.file.name} 处理结束，队列继续`);
        } catch (err) {
          console.error(`[队列错误] 未捕获的错误:`, err);
          // 确保即使有未捕获的错误也能继续处理队列
          return Promise.resolve();
        }
      },
      { priority: priority } // 添加优先级配置
    )
    .catch((queueErr) => {
      console.error(
        `[队列错误] 队列处理文件 ${file.file.name} 时出现错误:`,
        queueErr
      );
    });

  console.log(
    `[队列操作] 文件 ${file.file.name} 已添加到上传队列, 优先级: ${priority}`
  );
};

// 重试上传
export const retryUpload = (fileId: string, priority = 0): void => {
  const { resetFile } = useUploadStore.getState();
  resetFile(fileId);
  addFileToQueue(fileId, priority);
};

// 暂停单个文件上传
export const pauseFile = (fileId: string): void => {
  const { uploadFiles, updateFileStatus } = useUploadStore.getState();
  const file = uploadFiles.find((f) => f.id === fileId);

  if (!file || file.status !== UploadStatus.UPLOADING) {
    return;
  }

  // 中断该文件的上传
  if (fileAbortControllers[fileId]) {
    fileAbortControllers[fileId].abort();
    delete fileAbortControllers[fileId];
  }

  // 更新文件状态为暂停
  updateFileStatus(fileId, UploadStatus.PAUSED);
};

// 恢复单个文件上传
export const resumeFile = (fileId: string, priority = 0): void => {
  const { uploadFiles } = useUploadStore.getState();
  const file = uploadFiles.find((f) => f.id === fileId);

  console.log(`尝试恢复文件: ${fileId}, 当前状态:`, file?.status);

  if (!file) {
    console.error(`恢复上传失败: 找不到文件 ${fileId}`);
    return;
  }

  if (file.status !== UploadStatus.PAUSED) {
    console.error(`恢复上传失败: 文件状态不是暂停 (${file.status})`);
    return;
  }

  console.log(
    `恢复上传文件: ${fileId}, 文件名: ${file.file.name}, 优先级: ${priority}`
  );

  // 重新添加到上传队列
  addFileToQueue(fileId, priority);
};

// 暂停队列
export const pauseQueue = (): void => {
  // 暂停队列
  uploadQueue.pause();
  console.log("队列已暂停");

  // 暂停所有正在上传的文件
  const { uploadFiles } = useUploadStore.getState();
  const uploadingFiles = uploadFiles.filter(
    (file) => file.status === UploadStatus.UPLOADING
  );

  uploadingFiles.forEach((file) => {
    pauseFile(file.id);
  });
};

// 恢复队列
export const resumeQueue = async (concurrency?: number): Promise<void> => {
  // 如果提供了并发数，则更新队列并发数
  if (concurrency !== undefined) {
    updateQueueConcurrency(concurrency);
  }

  // 恢复队列处理
  uploadQueue.start();
  console.log("[队列操作] 队列已恢复");

  // 恢复所有暂停的文件
  const { uploadFiles } = useUploadStore.getState();
  const pausedFiles = uploadFiles.filter(
    (file) => file.status === UploadStatus.PAUSED
  );

  if (pausedFiles.length > 0) {
    console.log(`[队列操作] 开始恢复 ${pausedFiles.length} 个暂停的文件`);

    // 使用延迟策略添加文件，避免同时添加太多文件到队列造成阻塞
    for (let i = 0; i < pausedFiles.length; i++) {
      const file = pausedFiles[i];
      console.log(`[队列操作] 恢复文件 ${file.file.name}`);

      // 确保文件状态为暂停状态
      if (file.status === UploadStatus.PAUSED) {
        // 将文件添加到上传队列，优先级基于索引
        const priority = pausedFiles.length - i; // 较早的文件优先级更高
        addFileToQueue(file.id, priority, concurrency);

        // 每添加一个文件，等待100毫秒，避免过度阻塞
        if (i < pausedFiles.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }

    console.log(`[队列操作] 已恢复所有 ${pausedFiles.length} 个暂停的文件`);
  } else {
    console.log("[队列操作] 没有暂停的文件需要恢复");
  }
};

// 清空队列
export const clearQueue = (): void => {
  uploadQueue.clear();
  console.log("队列已清空");
};

// 获取队列状态
export const getQueueStats = () => {
  return {
    size: uploadQueue.size,
    pending: uploadQueue.pending,
    isPaused: uploadQueue.isPaused,
    concurrency: uploadQueue.concurrency,
  };
};

// 清除所有上传记录和缓存
export const clearAllUploads = async (): Promise<boolean> => {
  try {
    await dbService.clearAllFileMeta();
    return true;
  } catch (error) {
    console.error("清除所有上传记录失败:", error);
    return false;
  }
};

// 顺序上传多个文件
export const uploadFilesInSequence = async (
  fileIds: string[]
): Promise<void> => {
  // 先清空当前队列
  clearQueue();

  console.log(`[顺序上传] 开始按顺序上传 ${fileIds.length} 个文件`);

  // 逐个上传文件
  for (let i = 0; i < fileIds.length; i++) {
    const fileId = fileIds[i];
    const { uploadFiles } = useUploadStore.getState();
    const file = uploadFiles.find((f) => f.id === fileId);

    if (!file) {
      console.error(`[顺序上传] 文件ID ${fileId} 不存在，跳过`);
      continue;
    }

    console.log(
      `[顺序上传] 开始上传第 ${i + 1}/${fileIds.length} 个文件: ${
        file.file.name
      }`
    );

    // 添加到队列
    addFileToQueue(fileId, 9999);

    // 等待文件上传完成
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        const currentState = useUploadStore.getState();
        const currentFile = currentState.uploadFiles.find(
          (f) => f.id === fileId
        );

        if (
          currentFile &&
          (currentFile.status === UploadStatus.DONE ||
            currentFile.status === UploadStatus.ERROR ||
            currentFile.status === UploadStatus.INSTANT ||
            currentFile.status === UploadStatus.MERGE_ERROR)
        ) {
          console.log(
            `[顺序上传] 文件 ${file.file.name} 上传完成，状态: ${currentFile.status}`
          );
          clearInterval(checkInterval);
          resolve();
        }
      }, 500);
    });
  }

  console.log(`[顺序上传] 所有 ${fileIds.length} 个文件上传完成`);
};

// 自动根据网络状态暂停/恢复上传队列的 hook
export function useAutoPauseQueueOnNetworkChange() {
  const { networkType } = useNetworkType();
  React.useEffect(() => {
    if (networkType === "offline") {
      pauseQueue();
      message.warning("网络断开，上传已自动暂停");
    } else {
      resumeQueue();
      message.success("网络恢复，上传已自动恢复");
    }
  }, [networkType]);
}

// 断网检测：断网时暂停队列，联网后自动恢复
if (
  typeof window !== "undefined" &&
  typeof window.addEventListener === "function"
) {
  window.addEventListener("offline", () => {
    console.warn("[网络状态] 检测到断网，自动暂停上传队列");
    pauseQueue();
  });
  window.addEventListener("online", () => {
    console.info("[网络状态] 网络已恢复，自动恢复上传队列");
    resumeQueue();
  });
}
