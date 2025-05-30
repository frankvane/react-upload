import * as api from "./api";
import * as dbService from "./dbService";

import PQueue from "p-queue";
import SparkMD5 from "spark-md5";
import type { UploadFileMeta } from "../types/file";
import { UploadStatus } from "../types/upload";
import { useUploadStore } from "../store/uploadStore";

// 创建一个并发队列，最大并发数为3
const uploadQueue = new PQueue({ concurrency: 3 });

// 存储每个文件的中断控制器
const fileAbortControllers: Record<string, AbortController> = {};

// 默认分片大小：2MB
const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024;

// API 请求前缀
const API_PREFIX = "http://localhost:3000/api";

// 使用Worker计算文件哈希和分片哈希
export const calculateFileHashWithWorker = async (
  fileId: string,
  file: File
): Promise<{
  fileHash: string;
  chunkHashes: string[];
}> => {
  const { updateFileStatus } = useUploadStore.getState();

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
        chunkSize: DEFAULT_CHUNK_SIZE,
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

// 处理单个文件上传
export const processFileUpload = async (fileId: string): Promise<void> => {
  const {
    uploadFiles,
    updateFileStatus,
    updateFileHash,
    updateFileChunks,
    incrementUploadedChunks,
    setErrorMessage,
    updatePausedChunks,
  } = useUploadStore.getState();

  const uploadFile = uploadFiles.find((file) => file.id === fileId);
  if (!uploadFile) return;

  // 创建一个新的中断控制器
  const abortController = new AbortController();
  fileAbortControllers[fileId] = abortController;

  try {
    // 更新状态为计算中，初始进度为0
    updateFileStatus(fileId, UploadStatus.CALCULATING, 0);

    // 如果已经有哈希值（通过 addFile 设置），则使用它
    let fileHash = uploadFile.hash || "";
    let chunkHashes: string[] = [];

    // 如果没有哈希值，则计算文件哈希和分片哈希
    if (!fileHash) {
      const hashResult = await calculateFileHashWithWorker(
        fileId,
        uploadFile.file
      );
      fileHash = hashResult.fileHash;
      chunkHashes = hashResult.chunkHashes;
      updateFileHash(fileId, fileHash);
    } else {
      // 如果已有哈希值，仍需计算分片哈希
      const hashResult = await calculateFileHashWithWorker(
        fileId,
        uploadFile.file
      );
      chunkHashes = hashResult.chunkHashes;
    }

    // 准备分片上传
    const chunkSize = DEFAULT_CHUNK_SIZE;
    const chunkCount = Math.ceil(uploadFile.file.size / chunkSize);
    updateFileChunks(fileId, chunkSize, chunkCount);

    // 检查文件是否已存在于 IndexedDB 中
    const existingFile = await dbService.getFileMeta(fileHash);
    if (!existingFile) {
      // 文件不存在，才保存到 IndexedDB，便于断点续传
      await saveFileToIndexedDB(uploadFile.file, fileHash, chunkSize);
    }

    // 检查文件是否可以秒传
    const instantCheckResult = await checkInstantUpload(
      fileId,
      fileHash,
      uploadFile.file.name,
      uploadFile.file.size,
      chunkCount,
      chunkHashes
    );

    if (instantCheckResult.uploaded) {
      // 文件已存在，直接标记为完成
      updateFileStatus(fileId, UploadStatus.INSTANT, 100);

      // 秒传成功后，从 IndexedDB 中删除文件
      await dbService.removeFileMeta(fileHash);

      return;
    }

    // 更新状态为上传中
    updateFileStatus(fileId, UploadStatus.UPLOADING, 0);

    // 获取已上传的分片信息
    const uploadedChunks = await api.getFileStatus(
      {
        fileId,
        md5: fileHash,
      },
      { apiPrefix: API_PREFIX }
    );

    // 检查是否有暂停时保存的分片信息
    const pausedChunks = uploadFile.pausedChunks || [];
    const allUploadedChunks = [
      ...new Set([...uploadedChunks, ...pausedChunks]),
    ];

    // 上传未完成的分片
    const uploadTasks = [];
    for (let i = 0; i < chunkCount; i++) {
      // 检查分片是否已上传
      const isUploaded =
        allUploadedChunks.includes(i) ||
        instantCheckResult.chunkCheckResult.some(
          (chunk) => chunk.index === i && chunk.exist && chunk.match
        );

      if (!isUploaded) {
        uploadTasks.push(
          uploadFileChunk(
            fileId,
            uploadFile.file,
            i,
            chunkSize,
            chunkHashes[i],
            chunkCount,
            abortController.signal
          ).then((success) => {
            if (success) {
              incrementUploadedChunks(fileId);
            }
            return { index: i, success };
          })
        );
      } else {
        // 分片已上传，直接增加计数
        incrementUploadedChunks(fileId);
      }
    }

    // 等待所有分片上传完成
    const results = await Promise.all(uploadTasks);

    // 如果上传被中断，保存已上传的分片信息
    if (abortController.signal.aborted) {
      const successChunks = results
        .filter((result) => result.success)
        .map((result) => result.index);

      // 合并已上传的分片和新上传成功的分片
      const updatedPausedChunks = [
        ...new Set([...pausedChunks, ...successChunks]),
      ];
      updatePausedChunks(fileId, updatedPausedChunks);

      // 更新状态为暂停
      updateFileStatus(fileId, UploadStatus.PAUSED);
      return;
    }

    // 请求服务器合并分片
    await mergeFileChunks(
      fileId,
      fileHash,
      uploadFile.file.name,
      uploadFile.file.size,
      chunkCount
    );

    // 更新状态为完成
    updateFileStatus(fileId, UploadStatus.DONE, 100);

    // 上传成功后从 IndexedDB 中删除文件
    await dbService.removeFileMeta(fileHash);

    // 清除中断控制器
    delete fileAbortControllers[fileId];
  } catch (error) {
    // 如果是因为中断导致的错误，不做特殊处理
    if (error instanceof Error && error.name === "AbortError") {
      return;
    }

    // 处理错误
    console.error(`文件上传失败: ${uploadFile.file.name}`, error);

    if (error instanceof Error) {
      setErrorMessage(fileId, error.message);
    } else {
      setErrorMessage(fileId, "未知错误");
    }

    // 如果是合并错误
    if (error instanceof Error && error.message.includes("合并")) {
      updateFileStatus(fileId, UploadStatus.MERGE_ERROR);
    } else {
      updateFileStatus(fileId, UploadStatus.ERROR);
    }

    // 清除中断控制器
    delete fileAbortControllers[fileId];
  }
};

// 将文件添加到上传队列
export const addFileToQueue = (fileId: string): void => {
  const { uploadFiles, updateFileStatus } = useUploadStore.getState();

  // 查找文件
  const file = uploadFiles.find((f) => f.id === fileId);
  if (!file) return;

  // 如果文件已经在队列中或已完成，则不再添加
  if (
    file.status !== UploadStatus.QUEUED_FOR_UPLOAD &&
    file.status !== UploadStatus.ERROR &&
    file.status !== UploadStatus.MERGE_ERROR &&
    file.status !== UploadStatus.PAUSED
  ) {
    return;
  }

  // 将文件添加到上传队列
  uploadQueue.add(() => processFileUpload(fileId));

  // 更新文件状态为 QUEUED（已进入队列）
  updateFileStatus(fileId, UploadStatus.QUEUED);
};

// 重试上传
export const retryUpload = (fileId: string): void => {
  const { resetFile } = useUploadStore.getState();
  resetFile(fileId);
  addFileToQueue(fileId);
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
export const resumeFile = (fileId: string): void => {
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

  console.log(`恢复上传文件: ${fileId}, 文件名: ${file.file.name}`);

  // 重新添加到上传队列
  addFileToQueue(fileId);
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
export const resumeQueue = (): void => {
  // 恢复队列处理
  uploadQueue.start();

  // 恢复所有暂停的文件
  const { uploadFiles } = useUploadStore.getState();
  const pausedFiles = uploadFiles.filter(
    (file) => file.status === UploadStatus.PAUSED
  );

  pausedFiles.forEach((file) => {
    resumeFile(file.id);
  });
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
