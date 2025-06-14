import * as dbService from "../services/dbService";

import type { UploadFileMeta } from "../types/file";

/**
 * 生成稳定的文件 ID（基于文件名、大小和最后修改时间）
 * 这样相同的文件每次都会有相同的 ID
 */
export const generateStableFileId = (file: File): string => {
  return `${file.name}-${file.size}-${file.lastModified}`;
};

/**
 * 使用 Web Worker 将文件转换为 ArrayBuffer 并计算 MD5
 * 然后将结果存储到 IndexedDB 中
 * @param file 要处理的文件
 * @param chunkSize 分片大小（字节），基于网络状态动态计算
 */
export const processFileWithWorker = (
  file: File,
  chunkSize: number = 2 * 1024 * 1024,
  saveToIndexedDB: boolean = true
): Promise<UploadFileMeta> => {
  return new Promise((resolve, reject) => {
    try {
      // 创建 Web Worker，不使用模块类型
      const worker = new Worker(
        new URL("../workers/fileToArrayBuffer.worker.ts", import.meta.url)
      );

      // 监听 Worker 消息
      worker.onmessage = async (e) => {
        const { success, data, error } = e.data;

        // 终止 Worker
        worker.terminate();

        if (success && data) {
          // 将文件元数据添加到 IndexedDB
          const meta: UploadFileMeta = {
            ...data,
            addedAt: Date.now(),
            chunkSize: chunkSize, // 使用传入的网络自适应分片大小
          };

          // 只有当启用了IndexedDB存储时，才保存到数据库
          if (saveToIndexedDB) {
            try {
              // 保存到 IndexedDB，使用 MD5 作为 key
              await dbService.saveFileMeta(meta);
            } catch (saveError) {
              console.warn(`保存到 IndexedDB 失败: ${saveError}`);
              // 即使保存失败，仍然返回处理后的元数据
            }
          }

          resolve(meta);
        } else {
          reject(new Error(error || "文件处理失败"));
        }
      };

      // 处理 Worker 错误
      worker.onerror = (err) => {
        worker.terminate();
        reject(new Error(`Worker 错误: ${err.message}`));
      };

      // 发送文件到 Worker 进行处理
      worker.postMessage({ file });
    } catch (err) {
      reject(new Error(`创建 Worker 失败: ${err}`));
    }
  });
};

export function ByteConvert(size: number): string {
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(2) + " KB";
  if (size < 1024 * 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + " MB";
  return (size / 1024 / 1024 / 1024).toFixed(2) + " GB";
}
