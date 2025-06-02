import * as dbService from "../services/dbService";

import {
  addFileToQueue,
  clearQueue,
  getQueueStats,
  pauseQueue,
  resumeQueue,
  updateQueueConcurrency,
} from "../services/uploadService";
import { useCallback, useEffect, useState } from "react";

import type { UploadFile } from "../store/uploadStore";
import { UploadStatus } from "../types/upload";
import { message } from "antd";
import { useNetworkType } from "../hooks/useNetworkType";
import { useUploadStore } from "../store/uploadStore";

export function useUploadQueueActions(
  sortedFiles: UploadFile[],
  pageSize: number,
  onJumpToPage?: (page: number) => void
) {
  // 状态
  const [queuePaused, setQueuePaused] = useState<boolean>(false);
  const uploadFiles = useUploadStore((state) => state.uploadFiles);
  const removeFile = useUploadStore((state) => state.removeFile);
  const resetFile = useUploadStore((state) => state.resetFile);
  const { networkType, chunkSize, fileConcurrency, chunkConcurrency } =
    useNetworkType();
  const isOffline = networkType === "offline";

  // 监听网络状态变化，更新队列并发数
  useEffect(() => {
    updateQueueConcurrency(fileConcurrency);
    if (isOffline) {
      message.warning("网络已断开，上传功能将暂时不可用");
    }
  }, [networkType, chunkSize, fileConcurrency, chunkConcurrency, isOffline]);

  // 计算各种状态的文件
  const pendingFiles = uploadFiles.filter(
    (file) => file.status === UploadStatus.QUEUED_FOR_UPLOAD
  );
  const uploadingFiles = uploadFiles.filter((file) =>
    [
      UploadStatus.QUEUED,
      UploadStatus.CALCULATING,
      UploadStatus.PREPARING_UPLOAD,
      UploadStatus.UPLOADING,
    ].includes(file.status)
  );
  const pausedFiles = uploadFiles.filter(
    (file) => file.status === UploadStatus.PAUSED
  );
  const errorFiles = uploadFiles.filter(
    (file) =>
      file.status === UploadStatus.ERROR ||
      file.status === UploadStatus.MERGE_ERROR
  );

  // 上传
  const handleUpload = useCallback(() => {
    if (isOffline) {
      message.error("网络已断开，无法上传文件");
      return;
    }
    if (pendingFiles.length === 0) {
      message.warning("没有待上传的文件");
      return;
    }
    message.success(
      `开始上传 ${pendingFiles.length} 个文件 (并发数: ${fileConcurrency})`
    );
    setQueuePaused(false);
    const addFilesWithDelay = async () => {
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        addFileToQueue(file.id, fileConcurrency);
        if (i < pendingFiles.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    };
    addFilesWithDelay();
  }, [isOffline, pendingFiles, fileConcurrency]);

  // 暂停
  const handlePauseQueue = useCallback(async () => {
    if (isOffline) {
      message.error("网络已断开，无法操作上传队列");
      return;
    }
    if (uploadingFiles.length === 0 && pendingFiles.length === 0) {
      message.warning("没有正在上传或待上传的文件");
      return;
    }
    message.info("正在暂停上传队列...");
    pauseQueue();
    clearQueue();
    setQueuePaused(true);
  }, [isOffline, uploadingFiles, pendingFiles]);

  // 恢复
  const handleResumeQueue = useCallback(async () => {
    if (isOffline) {
      message.error("网络已断开，无法操作上传队列");
      return;
    }
    const unfinishedFiles = sortedFiles.filter(
      (file) =>
        file.status !== UploadStatus.DONE &&
        file.status !== UploadStatus.INSTANT &&
        file.status !== UploadStatus.ERROR &&
        file.status !== UploadStatus.MERGE_ERROR
    );
    if (unfinishedFiles.length === 0) {
      message.warning("没有暂停的文件需要恢复");
      return;
    }
    message.info(`正在恢复上传队列 (并发数: ${fileConcurrency})...`);
    await resumeQueue(fileConcurrency);
    for (let i = 0; i < unfinishedFiles.length; i++) {
      const file = unfinishedFiles[i];
      if (
        file.status === UploadStatus.PAUSED ||
        file.status === UploadStatus.ERROR ||
        file.status === UploadStatus.MERGE_ERROR
      ) {
        resetFile(file.id);
      }
      addFileToQueue(file.id, unfinishedFiles.length - i, fileConcurrency);
      if (i < unfinishedFiles.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    setQueuePaused(false);
    message.success(`已恢复上传队列 (并发数: ${fileConcurrency})`);
    if (unfinishedFiles.length > 0 && onJumpToPage) {
      const firstUnfinishedId = unfinishedFiles[0].id;
      const index = sortedFiles.findIndex((f) => f.id === firstUnfinishedId);
      const targetPage = Math.floor(index / pageSize) + 1;
      onJumpToPage(targetPage);
    }
  }, [
    isOffline,
    sortedFiles,
    fileConcurrency,
    resetFile,
    onJumpToPage,
    pageSize,
  ]);

  // 切换暂停/恢复
  const toggleQueuePause = useCallback(async () => {
    if (queuePaused) {
      await handleResumeQueue();
    } else {
      await handlePauseQueue();
    }
  }, [queuePaused, handleResumeQueue, handlePauseQueue]);

  // 清空
  const handleClearQueue = useCallback(async () => {
    clearQueue();
    try {
      await dbService.clearAllFileMeta();
    } catch (error) {
      console.error("清空 IndexedDB 失败:", error);
    }
    uploadFiles.forEach((file) => {
      removeFile(file.id);
    });
    setQueuePaused(false);
    message.success("已清空所有文件");
  }, [uploadFiles, removeFile]);

  // 重试
  const handleRetryAllFailed = useCallback(() => {
    if (isOffline) {
      message.error("网络已断开，无法重试失败的文件");
      return;
    }
    const errorAndAbortedFiles = uploadFiles.filter(
      (file) =>
        file.status === UploadStatus.ERROR ||
        file.status === UploadStatus.MERGE_ERROR
    );
    const retryCount = errorAndAbortedFiles.length;
    if (retryCount === 0) {
      message.warning("没有失败或已中断的文件需要重试");
      return;
    }
    if (queuePaused) {
      setQueuePaused(false);
    }
    message.success(
      `开始重试 ${retryCount} 个失败或已中断的文件 (并发数: ${fileConcurrency})`
    );
    const retryFilesWithDelay = async () => {
      const queueStats = getQueueStats();
      if (queueStats.isPaused) {
        resumeQueue(fileConcurrency);
      }
      for (let i = 0; i < errorAndAbortedFiles.length; i++) {
        const file = errorAndAbortedFiles[i];
        resetFile(file.id);
        addFileToQueue(file.id, fileConcurrency);
        if (i < errorAndAbortedFiles.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    };
    retryFilesWithDelay();
  }, [isOffline, uploadFiles, fileConcurrency, queuePaused, resetFile]);

  // 统计
  const totalPendingCount = pendingFiles.length;
  const totalFailedCount = errorFiles.length;

  return {
    queuePaused,
    setQueuePaused,
    isOffline,
    uploadingFiles,
    pendingFiles,
    pausedFiles,
    errorFiles,
    uploadFiles,
    handleUpload,
    handlePauseQueue,
    handleResumeQueue,
    toggleQueuePause,
    handleClearQueue,
    handleRetryAllFailed,
    totalPendingCount,
    totalFailedCount,
  };
}
