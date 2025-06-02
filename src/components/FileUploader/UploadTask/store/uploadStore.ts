import * as dbService from "../services/dbService";

import { UploadStatus } from "../types/upload";
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { generateStableFileId } from "../utils/fileUtils";
import { persist } from "zustand/middleware";

// 保存一个全局的文件映射表，用于存储文件引用，但不放入zustand状态中
// 这样可以在需要时获取文件，但不会增加状态的内存占用
const fileMap = new Map<string, File>();

// 定义单个上传文件的状态结构
export interface UploadFile {
  id: string; // 唯一ID
  fileName: string; // 文件名
  fileSize: number; // 文件大小
  fileType: string; // 文件类型
  lastModified: number; // 最后修改时间
  status: UploadStatus; // 上传状态
  progress: number; // 上传进度 (0-100)
  hash?: string; // 文件哈希值
  chunkSize?: number; // 分片大小
  chunkCount?: number; // 分片总数
  uploadedChunks?: number; // 已上传分片数
  pausedChunks?: number[]; // 暂停时已上传的分片索引
  errorMessage?: string; // 错误信息
  createdAt: number; // 创建时间戳
  order: number; // 上传顺序
}

// 定义整个上传队列的状态结构
interface UploadState {
  uploadFiles: UploadFile[]; // 待上传文件列表
  useIndexedDB: boolean; // 是否使用IndexedDB存储
  setUseIndexedDB: (value: boolean) => void; // 设置是否使用IndexedDB存储
  addFile: (file: File, md5?: string) => string; // 添加文件到队列，返回文件ID
  updateFileStatus: (
    id: string,
    status: UploadStatus,
    progress?: number
  ) => void; // 更新文件状态和进度
  updateFileHash: (id: string, hash: string) => void; // 更新文件哈希值
  updateFileChunks: (id: string, chunkSize: number, chunkCount: number) => void; // 更新文件分片信息
  incrementUploadedChunks: (id: string) => void; // 增加已上传分片数
  updatePausedChunks: (id: string, chunks: number[]) => void; // 更新暂停时已上传的分片索引
  setErrorMessage: (id: string, message: string) => void; // 设置错误信息
  removeFile: (id: string) => void; // 从队列中移除文件
  clearCompleted: () => void; // 清除已完成的文件
  resetFile: (id: string) => void; // 重置文件状态，用于重试
  initializeFromIndexedDB: () => Promise<void>; // 从IndexedDB初始化文件列表
  getFile: (id: string) => File | undefined; // 根据ID获取文件对象
}

// 创建 Zustand store
export const useUploadStore = create<UploadState>()(
  persist(
    devtools((set) => ({
      uploadFiles: [],
      useIndexedDB: false, // 默认禁用IndexedDB存储

      // 设置是否使用IndexedDB存储
      setUseIndexedDB: (value: boolean) => {
        set({ useIndexedDB: value }, false, { type: "setUseIndexedDB", value });
      },

      // 获取文件对象的方法
      getFile: (id: string) => {
        return fileMap.get(id);
      },

      addFile: (file: File, md5?: string) => {
        // 使用 MD5 作为文件 ID，如果没有提供则使用稳定的文件 ID 生成方式
        const fileId = md5 || generateStableFileId(file);

        set(
          (state) => {
            // 检查文件是否已经在队列中
            const existingFile = state.uploadFiles.find(
              (uploadFile) => uploadFile.id === fileId
            );

            let newUploadFiles: UploadFile[];
            if (existingFile) {
              // 如果文件已经在队列中，并且状态是已完成或秒传，则不做任何操作
              if (
                existingFile.status === UploadStatus.DONE ||
                existingFile.status === UploadStatus.INSTANT
              ) {
                newUploadFiles = state.uploadFiles;
              } else {
                // 如果文件已经在队列中，但状态不是已完成或秒传，则重置其状态
                newUploadFiles = state.uploadFiles.map((uploadFile) =>
                  uploadFile.id === fileId
                    ? {
                        ...uploadFile,
                        status: UploadStatus.QUEUED_FOR_UPLOAD,
                        progress: 0,
                        uploadedChunks: 0,
                        pausedChunks: [],
                        errorMessage: undefined,
                        createdAt: Date.now(),
                      }
                    : uploadFile
                );
              }
            } else {
              // 将文件保存到映射表中，但不直接保存到状态中
              fileMap.set(fileId, file);
              // 如果文件不在队列中，则添加到队列（只存储必要的文件信息，减少内存占用）
              newUploadFiles = [
                ...state.uploadFiles,
                {
                  id: fileId,
                  fileName: file.name,
                  fileSize: file.size,
                  fileType: file.type,
                  lastModified: file.lastModified,
                  status: UploadStatus.QUEUED_FOR_UPLOAD, // 选中文件后即为等待上传状态
                  progress: 0,
                  hash: md5, // 如果提供了 MD5，则设置哈希值
                  pausedChunks: [],
                  createdAt: Date.now(),
                  order: 0, // 先占位，后面统一分配
                },
              ];
            }

            // 统一为所有文件分配order，保证顺序唯一且递增
            newUploadFiles = newUploadFiles
              .map((file, idx) => ({ ...file, order: idx }))
              .sort((a, b) => a.order - b.order);

            return {
              uploadFiles: newUploadFiles,
            };
          },
          false,
          { type: "addFile", file: file.name, id: fileId }
        );

        return fileId;
      },

      updateFileStatus: (id, status, progress = 0) => {
        set(
          (state) => ({
            uploadFiles: state.uploadFiles.map((uploadFile) =>
              uploadFile.id === id
                ? { ...uploadFile, status, progress }
                : uploadFile
            ),
          }),
          false,
          { type: "updateFileStatus", id, status, progress }
        );
      },

      updateFileHash: (id, hash) => {
        set(
          (state) => ({
            uploadFiles: state.uploadFiles.map((uploadFile) =>
              uploadFile.id === id ? { ...uploadFile, hash } : uploadFile
            ),
          }),
          false,
          { type: "updateFileHash", id, hash }
        );
      },

      updateFileChunks: (id, chunkSize, chunkCount) => {
        set(
          (state) => ({
            uploadFiles: state.uploadFiles.map((uploadFile) =>
              uploadFile.id === id
                ? { ...uploadFile, chunkSize, chunkCount, uploadedChunks: 0 }
                : uploadFile
            ),
          }),
          false,
          { type: "updateFileChunks", id, chunkSize, chunkCount }
        );
      },

      incrementUploadedChunks: (id) => {
        set(
          (state) => {
            const uploadFile = state.uploadFiles.find(
              (uploadFile) => uploadFile.id === id
            );

            if (!uploadFile || !uploadFile.chunkCount) {
              return { uploadFiles: state.uploadFiles };
            }

            const uploadedChunks = (uploadFile.uploadedChunks || 0) + 1;
            const progress = Math.floor(
              (uploadedChunks / uploadFile.chunkCount) * 100
            );

            return {
              uploadFiles: state.uploadFiles.map((uploadFile) =>
                uploadFile.id === id
                  ? { ...uploadFile, uploadedChunks, progress }
                  : uploadFile
              ),
            };
          },
          false,
          { type: "incrementUploadedChunks", id }
        );
      },

      updatePausedChunks: (id, pausedChunks) => {
        set(
          (state) => ({
            uploadFiles: state.uploadFiles.map((uploadFile) =>
              uploadFile.id === id
                ? { ...uploadFile, pausedChunks }
                : uploadFile
            ),
          }),
          false,
          {
            type: "updatePausedChunks",
            id,
            pausedChunksCount: pausedChunks.length,
          }
        );
      },

      setErrorMessage: (id, errorMessage) => {
        set(
          (state) => ({
            uploadFiles: state.uploadFiles.map((uploadFile) =>
              uploadFile.id === id
                ? { ...uploadFile, errorMessage }
                : uploadFile
            ),
          }),
          false,
          { type: "setErrorMessage", id, errorMessage }
        );
      },

      removeFile: (id) => {
        // 从fileMap中移除文件对象，释放内存
        fileMap.delete(id);

        set(
          (state) => {
            const filtered = state.uploadFiles.filter(
              (uploadFile) => uploadFile.id !== id
            );
            // 自动重排order
            const reordered = filtered.map((file, idx) => ({
              ...file,
              order: idx,
            }));
            return {
              uploadFiles: reordered,
            };
          },
          false,
          { type: "removeFile", id }
        );
      },

      clearCompleted: () => {
        set(
          (state) => {
            // 找出已完成的文件ID
            const completedIds = state.uploadFiles
              .filter(
                (file) =>
                  file.status === UploadStatus.DONE ||
                  file.status === UploadStatus.INSTANT
              )
              .map((file) => file.id);

            // 从fileMap中移除这些文件
            completedIds.forEach((id) => fileMap.delete(id));

            const filtered = state.uploadFiles.filter(
              (uploadFile) =>
                uploadFile.status !== UploadStatus.DONE &&
                uploadFile.status !== UploadStatus.INSTANT
            );
            // 自动重排order
            const reordered = filtered.map((file, idx) => ({
              ...file,
              order: idx,
            }));
            return {
              uploadFiles: reordered,
            };
          },
          false,
          { type: "clearCompleted" }
        );
      },

      resetFile: (id) => {
        set(
          (state) => {
            const updated = state.uploadFiles.map((uploadFile) =>
              uploadFile.id === id
                ? {
                    ...uploadFile,
                    status: UploadStatus.QUEUED_FOR_UPLOAD,
                    progress: 0,
                    uploadedChunks: 0,
                    pausedChunks: [],
                    errorMessage: undefined,
                  }
                : uploadFile
            );
            // 自动重排order
            const reordered = updated.map((file, idx) => ({
              ...file,
              order: idx,
            }));
            return {
              uploadFiles: reordered,
            };
          },
          false,
          { type: "resetFile", id }
        );
      },

      // 从 IndexedDB 初始化文件列表
      initializeFromIndexedDB: async () => {
        try {
          // 检查是否启用了IndexedDB
          const { useIndexedDB } = useUploadStore.getState();
          if (!useIndexedDB) {
            return; // 如果禁用了IndexedDB，则直接返回
          }

          // 获取所有存储在 IndexedDB 中的文件元数据
          const fileMetas = await dbService.getAllFileMeta();

          if (!fileMetas || fileMetas.length === 0) return;

          // 将文件元数据转换为 File 对象并添加到 store
          const files: UploadFile[] = fileMetas.map((meta) => {
            // 从 ArrayBuffer 创建 File 对象
            const file = new File([meta.buffer], meta.name, {
              type: meta.type,
              lastModified: meta.lastModified,
            });

            // 将文件保存到映射表中
            fileMap.set(meta.key, file);

            // 使用 meta.key 作为文件 ID，它是文件的 MD5 哈希值
            return {
              id: meta.key,
              fileName: meta.name,
              fileSize: meta.size,
              fileType: meta.type,
              lastModified: meta.lastModified,
              status: UploadStatus.QUEUED_FOR_UPLOAD, // 初始状态为待上传
              progress: 0,
              hash: meta.key, // 使用 MD5 作为哈希值
              chunkSize: meta.chunkSize,
              chunkCount: Math.ceil(meta.size / meta.chunkSize),
              uploadedChunks: 0,
              pausedChunks: [],
              createdAt: meta.addedAt,
              order: 0, // 先占位，后面统一分配
            };
          });

          // 自动重排order
          const reordered = files.map((file, idx) => ({
            ...file,
            order: idx,
          }));

          // 更新 store 中的文件列表
          set(
            (state) => ({
              uploadFiles: [
                ...state.uploadFiles,
                ...reordered.filter(
                  (file) => !state.uploadFiles.some((f) => f.id === file.id)
                ),
              ].map((file, idx) => ({ ...file, order: idx })), // 再次全局重排order
            }),
            false,
            { type: "initializeFromIndexedDB", filesCount: files.length }
          );
        } catch (error) {
          console.error("从 IndexedDB 初始化文件列表失败:", error);
        }
      },
    })),
    {
      name: "upload-store-persist",
      partialize: (state) => ({ useIndexedDB: state.useIndexedDB }),
    }
  )
);
