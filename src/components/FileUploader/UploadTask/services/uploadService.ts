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

// 存储每个文件的中断控制器
const fileAbortControllers: Record<string, AbortController> = {};

// 更新队列并发数
export const updateQueueConcurrency = (concurrency: number) => {
  // 确保 concurrency 至少为 1，防止 p-queue 抛出错误
  const safeValue = Math.max(1, concurrency);

  if (uploadQueue.concurrency !== safeValue) {
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
  const { updateFileStatus, useIndexedDB } = useUploadStore.getState();

  // 设置默认分片大小
  let chunkSize = DEFAULT_CHUNK_SIZE; // 默认分片大小

  // 只有当启用了IndexedDB时，才尝试从中获取数据
  if (useIndexedDB) {
    try {
      const fileMeta = await dbService.getFileMeta(fileId);
      if (fileMeta && fileMeta.chunkSize) {
        chunkSize = fileMeta.chunkSize;
      }
    } catch {
      // 无法获取元数据，使用默认切片大小
    }
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
  // 检查是否启用了IndexedDB存储
  const { useIndexedDB } = useUploadStore.getState();
  if (!useIndexedDB) {
    return false; // 如果禁用了IndexedDB，则直接返回false
  }

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
  } catch {
    // 保存失败
    return false;
  }
};

// 从 IndexedDB 获取文件元数据
export const getFileFromIndexedDB = async (
  fileId: string
): Promise<UploadFileMeta | null> => {
  // 检查是否启用了IndexedDB存储
  const { useIndexedDB } = useUploadStore.getState();
  if (!useIndexedDB) {
    return null; // 如果禁用了IndexedDB，则直接返回null
  }

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
  } catch {
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
      return false;
    }
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
      onFailedAttempt: () => {},
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
};

// 处理单个文件上传
export const processFileUpload = async (fileId: string): Promise<void> => {
  const {
    uploadFiles,
    updateFileStatus,
    updateFileHash,
    updateFileChunks,
    updatePausedChunks,
    setErrorMessage,
    getFile,
    incrementUploadedChunks,
    useIndexedDB,
  } = useUploadStore.getState();

  // 获取当前的上传文件信息
  const uploadFile = uploadFiles.find((file) => file.id === fileId);

  if (!uploadFile) {
    return;
  }

  // 使用getFile获取File对象
  const file = getFile(fileId);
  if (!file) {
    return;
  }

  try {
    // 更新状态为计算哈希中
    updateFileStatus(fileId, UploadStatus.CALCULATING, 0);

    // 检查状态是否合法
    if (
      uploadFile.status !== UploadStatus.QUEUED_FOR_UPLOAD &&
      uploadFile.status !== UploadStatus.QUEUED &&
      uploadFile.status !== UploadStatus.PAUSED
    ) {
      return;
    }

    let savedChunkSize: number | undefined;

    // 检查是否已经保存到 IndexedDB
    if (useIndexedDB) {
      try {
        const existingData = await dbService.getFileMeta(fileId);
        if (existingData) {
          savedChunkSize = existingData.chunkSize;
        }
      } catch {
        // 无法获取元数据，继续使用默认值
      }
    }

    // 使用 Worker 计算文件哈希和分片哈希
    const { fileHash, chunkHashes } = await calculateFileHashWithWorker(
      fileId,
      file
    );

    // 更新哈希值
    updateFileHash(fileId, fileHash);

    // 准备上传
    updateFileStatus(fileId, UploadStatus.PREPARING_UPLOAD, 0);

    // 检查是否可以秒传
    const fileName = uploadFile.fileName;
    const fileSize = uploadFile.fileSize;
    const chunkSize = savedChunkSize || DEFAULT_CHUNK_SIZE; // 使用保存的切片大小或默认值
    const chunkCount = Math.ceil(fileSize / chunkSize);

    // 更新文件分片信息
    updateFileChunks(fileId, chunkSize, chunkCount);

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

      // 秒传成功后，从IndexedDB中删除记录
      if (useIndexedDB) {
        try {
          await dbService.removeFileMeta(fileHash);
        } catch {
          // 清理失败，但不影响上传流程
        }
      }

      return;
    }

    // 如果不能秒传，开始正常上传流程
    updateFileStatus(fileId, UploadStatus.UPLOADING, 0);

    // 获取已经上传的分片索引
    const uploadedChunks = checkResult.chunkCheckResult
      .filter((result) => result.exist && result.match)
      .map((result) => result.index);

    // 更新暂停时已上传的分片索引
    updatePausedChunks(fileId, uploadedChunks);

    // 创建中断控制器
    const abortController = new AbortController();
    fileAbortControllers[fileId] = abortController;

    // 计算需要上传的分片
    const chunksToUpload = Array.from({ length: chunkCount })
      .map((_, index) => index)
      .filter((index) => !uploadedChunks.includes(index));

    // 如果所有分片都已上传，直接合并
    if (chunksToUpload.length === 0) {
      try {
        await mergeFileChunks(fileId, fileHash, fileName, fileSize, chunkCount);
        updateFileStatus(fileId, UploadStatus.DONE, 100);

        // 清理 IndexedDB 中的文件元数据
        if (useIndexedDB) {
          try {
            await dbService.removeFileMeta(fileHash);
          } catch {
            // 清理失败，但不影响上传流程
          }
        }
      } catch (err) {
        setErrorMessage(
          fileId,
          `合并失败: ${err instanceof Error ? err.message : String(err)}`
        );
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

    const chunkQueue = new PQueue({ concurrency: chunkConcurrency });

    // 监听中断信号
    abortController.signal.addEventListener("abort", () => {
      isAborted = true;
      chunkQueue.clear();
    });

    // 启动所有分片的上传任务
    try {
      await Promise.allSettled(
        chunksToUpload.map((chunkIndex) =>
          chunkQueue.add(async () => {
            if (isAborted) return;

            try {
              // 上传分片
              const chunkUploadResult = await uploadFileChunkWithRetry(
                fileId,
                file, // 使用getFile获取的file对象
                chunkIndex,
                chunkSize,
                chunkHashes[chunkIndex],
                chunkCount,
                abortController.signal
              );

              if (chunkUploadResult) {
                successCount++;
                incrementUploadedChunks(fileId);

                // 检查所有分片是否已上传完成
                if (successCount === chunksToUpload.length) {
                  try {
                    await mergeFileChunks(
                      fileId,
                      fileHash,
                      fileName,
                      fileSize,
                      chunkCount
                    );
                    updateFileStatus(fileId, UploadStatus.DONE, 100);

                    // 清理 IndexedDB 中的文件元数据
                    if (useIndexedDB) {
                      try {
                        await dbService.removeFileMeta(fileHash);
                      } catch {
                        // 清理失败，但不影响上传流程
                      }
                    }
                  } catch (err) {
                    setErrorMessage(
                      fileId,
                      `合并失败: ${
                        err instanceof Error ? err.message : String(err)
                      }`
                    );
                    updateFileStatus(fileId, UploadStatus.MERGE_ERROR, 0);
                  }
                }
              }
            } catch (err) {
              isAborted = true;
              chunkQueue.clear();
              setErrorMessage(
                fileId,
                `分片上传失败: ${
                  err instanceof Error ? err.message : String(err)
                }`
              );
              updateFileStatus(fileId, UploadStatus.ERROR, 0);
            }
          })
        )
      );

      // 如果没有中断但也没有全部完成，说明有部分分片上传失败
      if (!isAborted && successCount < chunksToUpload.length) {
        setErrorMessage(
          fileId,
          `有 ${chunksToUpload.length - successCount} 个分片上传失败，请重试`
        );
        updateFileStatus(fileId, UploadStatus.ERROR, 0);
      }
    } catch (err) {
      setErrorMessage(
        fileId,
        `上传失败: ${err instanceof Error ? err.message : String(err)}`
      );
      updateFileStatus(fileId, UploadStatus.ERROR, 0);
    } finally {
      // 清除中断控制器
      delete fileAbortControllers[fileId];
    }
  } catch (err) {
    setErrorMessage(fileId, err instanceof Error ? err.message : String(err));
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
    return;
  }

  // 如果文件已经在队列中或已完成，则不再添加
  if (
    file.status !== UploadStatus.QUEUED_FOR_UPLOAD &&
    file.status !== UploadStatus.ERROR &&
    file.status !== UploadStatus.MERGE_ERROR &&
    file.status !== UploadStatus.PAUSED
  ) {
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
        try {
          await processFileUpload(fileId).catch(() => {
            // 确保即使有错误也能继续处理队列
            return Promise.resolve();
          });
        } catch {
          // 确保即使有未捕获的错误也能继续处理队列
          return Promise.resolve();
        }
      },
      { priority: priority } // 添加优先级配置
    )
    .catch(() => {});
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

  if (!file) {
    return;
  }

  if (file.status !== UploadStatus.PAUSED) {
    return;
  }

  // 重新添加到上传队列
  addFileToQueue(fileId, priority);
};

// 暂停队列
export const pauseQueue = (): void => {
  // 暂停队列
  uploadQueue.pause();

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

  // 恢复所有暂停的文件
  const { uploadFiles } = useUploadStore.getState();
  const pausedFiles = uploadFiles.filter(
    (file) => file.status === UploadStatus.PAUSED
  );

  if (pausedFiles.length > 0) {
    for (let i = 0; i < pausedFiles.length; i++) {
      const file = pausedFiles[i];

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
  }
};

// 清空队列
export const clearQueue = (): void => {
  uploadQueue.clear();
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
  // 检查是否启用了IndexedDB存储
  const { useIndexedDB } = useUploadStore.getState();
  if (!useIndexedDB) {
    return true; // 如果禁用了IndexedDB，则直接返回true
  }

  try {
    await dbService.clearAllFileMeta();
    return true;
  } catch {
    return false;
  }
};

// 顺序上传多个文件
export const uploadFilesInSequence = async (
  fileIds: string[]
): Promise<void> => {
  // 先清空当前队列
  clearQueue();

  // 逐个上传文件
  for (let i = 0; i < fileIds.length; i++) {
    const fileId = fileIds[i];
    const { uploadFiles } = useUploadStore.getState();
    const file = uploadFiles.find((f) => f.id === fileId);

    if (!file) {
      continue;
    }

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
          clearInterval(checkInterval);
          resolve();
        }
      }, 500);
    });
  }
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
