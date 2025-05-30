import * as api from "./api";
import * as dbService from "./dbService";

import PQueue from "p-queue";
import SparkMD5 from "spark-md5";
import type { UploadFileMeta } from "../types/file";
import { UploadStatus } from "../types/upload";
import { useUploadStore } from "../store/uploadStore";

// 创建一个并发队列，最大并发数为3
const uploadQueue = new PQueue({ concurrency: 3 });

// 默认分片大小：2MB
const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024;

// API 请求前缀
const API_PREFIX = "http://localhost:3000/api";

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
    const { fileHash } = await calculateFileHash(file);

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
  totalChunks: number
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
      { apiPrefix: API_PREFIX }
    );

    return result.code === 200;
  } catch (error) {
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
  } = useUploadStore.getState();

  const uploadFile = uploadFiles.find((file) => file.id === fileId);
  if (!uploadFile) return;

  try {
    // 更新状态为计算中
    updateFileStatus(fileId, UploadStatus.CALCULATING);

    // 计算文件哈希和分片哈希
    const { fileHash, chunkHashes } = await calculateFileHash(uploadFile.file);
    updateFileHash(fileId, fileHash);

    // 准备分片上传
    const chunkSize = DEFAULT_CHUNK_SIZE;
    const chunkCount = Math.ceil(uploadFile.file.size / chunkSize);
    updateFileChunks(fileId, chunkSize, chunkCount);

    // 检查文件是否已存在于 IndexedDB 中
    const existingFile = await dbService.getFileMeta(fileHash);
    if (!existingFile) {
      // 文件不存在，才保存到 IndexedDB，便于断点续传
      await saveFileToIndexedDB(uploadFile.file, fileId, chunkSize);
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

    // 上传未完成的分片
    const uploadTasks = [];
    for (let i = 0; i < chunkCount; i++) {
      // 检查分片是否已上传
      const isUploaded =
        uploadedChunks.includes(i) ||
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
            chunkCount
          ).then(() => {
            incrementUploadedChunks(fileId);
          })
        );
      } else {
        // 分片已上传，直接增加计数
        incrementUploadedChunks(fileId);
      }
    }

    // 等待所有分片上传完成
    await Promise.all(uploadTasks);

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

    // 上传成功后可以从 IndexedDB 中删除文件
    await dbService.removeFileMeta(fileId);
  } catch (error) {
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
    file.status !== UploadStatus.MERGE_ERROR
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

// 暂停队列
export const pauseQueue = (): void => {
  uploadQueue.pause();
};

// 恢复队列
export const resumeQueue = (): void => {
  uploadQueue.start();
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
