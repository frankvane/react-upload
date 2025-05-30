import { UploadStatus } from "../types/upload";
import { create } from "zustand";

// 定义单个上传文件的状态结构
export interface UploadFile {
  id: string; // 唯一ID
  file: File; // 原始文件对象
  status: UploadStatus; // 上传状态
  progress: number; // 上传进度 (0-100)
  hash?: string; // 文件哈希值
  chunkSize?: number; // 分片大小
  chunkCount?: number; // 分片总数
  uploadedChunks?: number; // 已上传分片数
  errorMessage?: string; // 错误信息
  createdAt: number; // 创建时间戳
}

// 定义整个上传队列的状态结构
interface UploadState {
  uploadFiles: UploadFile[]; // 待上传文件列表
  addFile: (file: File) => string; // 添加文件到队列，返回文件ID
  updateFileStatus: (
    id: string,
    status: UploadStatus,
    progress?: number
  ) => void; // 更新文件状态和进度
  updateFileHash: (id: string, hash: string) => void; // 更新文件哈希值
  updateFileChunks: (id: string, chunkSize: number, chunkCount: number) => void; // 更新文件分片信息
  incrementUploadedChunks: (id: string) => void; // 增加已上传分片数
  setErrorMessage: (id: string, message: string) => void; // 设置错误信息
  removeFile: (id: string) => void; // 从队列中移除文件
  clearCompleted: () => void; // 清除已完成的文件
  resetFile: (id: string) => void; // 重置文件状态，用于重试
}

// 创建 Zustand store
export const useUploadStore = create<UploadState>((set) => ({
  uploadFiles: [],

  addFile: (file: File) => {
    const fileId = `${file.name}-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 9)}`;
    set((state) => ({
      uploadFiles: [
        ...state.uploadFiles,
        {
          id: fileId,
          file,
          status: UploadStatus.QUEUED_FOR_UPLOAD, // 选中文件后即为等待上传状态
          progress: 0,
          createdAt: Date.now(),
        },
      ],
    }));
    return fileId;
  },

  updateFileStatus: (id: string, status: UploadStatus, progress?: number) =>
    set((state) => ({
      uploadFiles: state.uploadFiles.map((uploadFile) =>
        uploadFile.id === id
          ? {
              ...uploadFile,
              status,
              progress: progress !== undefined ? progress : uploadFile.progress,
            }
          : uploadFile
      ),
    })),

  updateFileHash: (id: string, hash: string) =>
    set((state) => ({
      uploadFiles: state.uploadFiles.map((uploadFile) =>
        uploadFile.id === id ? { ...uploadFile, hash } : uploadFile
      ),
    })),

  updateFileChunks: (id: string, chunkSize: number, chunkCount: number) =>
    set((state) => ({
      uploadFiles: state.uploadFiles.map((uploadFile) =>
        uploadFile.id === id
          ? {
              ...uploadFile,
              chunkSize,
              chunkCount,
              uploadedChunks: 0,
            }
          : uploadFile
      ),
    })),

  incrementUploadedChunks: (id: string) =>
    set((state) => ({
      uploadFiles: state.uploadFiles.map((uploadFile) =>
        uploadFile.id === id
          ? {
              ...uploadFile,
              uploadedChunks: (uploadFile.uploadedChunks || 0) + 1,
              progress: uploadFile.chunkCount
                ? Math.min(
                    100,
                    Math.round(
                      (((uploadFile.uploadedChunks || 0) + 1) /
                        uploadFile.chunkCount) *
                        100
                    )
                  )
                : uploadFile.progress,
            }
          : uploadFile
      ),
    })),

  setErrorMessage: (id: string, errorMessage: string) =>
    set((state) => ({
      uploadFiles: state.uploadFiles.map((uploadFile) =>
        uploadFile.id === id ? { ...uploadFile, errorMessage } : uploadFile
      ),
    })),

  removeFile: (id: string) =>
    set((state) => ({
      uploadFiles: state.uploadFiles.filter(
        (uploadFile) => uploadFile.id !== id
      ),
    })),

  clearCompleted: () =>
    set((state) => ({
      uploadFiles: state.uploadFiles.filter(
        (uploadFile) =>
          uploadFile.status !== UploadStatus.DONE &&
          uploadFile.status !== UploadStatus.INSTANT
      ),
    })),

  resetFile: (id: string) =>
    set((state) => ({
      uploadFiles: state.uploadFiles.map((uploadFile) =>
        uploadFile.id === id
          ? {
              ...uploadFile,
              status: UploadStatus.QUEUED_FOR_UPLOAD,
              progress: 0,
              uploadedChunks: 0,
              errorMessage: undefined,
            }
          : uploadFile
      ),
    })),
}));
