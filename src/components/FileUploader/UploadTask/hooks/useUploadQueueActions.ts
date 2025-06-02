import {
  getQueueStats,
  pauseQueue,
  resumeQueue,
  updateQueueConcurrency,
  uploadFilesInSequence,
} from "../services/uploadService";
import { useCallback, useEffect, useMemo, useState } from "react";

import { UploadStatus } from "../types/upload";
import { message } from "antd";
import { useNetworkType } from "../hooks/useNetworkType";
import { useUploadStore } from "../store/uploadStore";

export const useUploadQueueActions = (/* Parameters removed */) => {
  const { uploadFiles, clearAllFiles } = useUploadStore();
  const { networkType, fileConcurrency } = useNetworkType();
  const [queuePaused, setQueuePaused] = useState(false);

  // 使用useMemo缓存过滤后的文件列表，避免不必要的重复计算
  const sortedFiles = useMemo(
    () => Object.values(uploadFiles).sort((a, b) => a.order - b.order),
    [uploadFiles]
  );

  const uploadingFiles = useMemo(
    () => sortedFiles.filter((file) => file.status === UploadStatus.UPLOADING),
    [sortedFiles]
  );
  const pendingFiles = useMemo(
    () =>
      sortedFiles.filter(
        (file) => file.status === UploadStatus.QUEUED_FOR_UPLOAD
      ),
    [sortedFiles]
  );
  const pausedFiles = useMemo(
    () => sortedFiles.filter((file) => file.status === UploadStatus.PAUSED),
    [sortedFiles]
  );
  const errorFiles = useMemo(
    () =>
      sortedFiles.filter(
        (file) =>
          file.status === UploadStatus.ERROR ||
          file.status === UploadStatus.MERGE_ERROR
      ),
    [sortedFiles]
  );

  // 统计
  const totalPendingCount = pendingFiles.length + pausedFiles.length;
  const totalFailedCount = errorFiles.length;

  // 上传队列中的所有操作函数
  const handleUpload = useCallback(() => {
    // 过滤出待上传和暂停的文件
    const filesToUpload = sortedFiles.filter(
      (file) =>
        file.status === UploadStatus.QUEUED_FOR_UPLOAD ||
        file.status === UploadStatus.PAUSED
    );

    const fileIdsToUpload = filesToUpload.map((file) => file.id);

    if (fileIdsToUpload.length > 0) {
      // 确保队列处于启动状态
      const queueStats = getQueueStats();
      if (queueStats.isPaused) {
        resumeQueue();
      }
      // 根据网络状态更新文件上传队列的并发数
      updateQueueConcurrency(fileConcurrency);
      // 使用uploadFilesInSequence批量添加并启动上传
      uploadFilesInSequence(fileIdsToUpload);
      message.success(`开始上传 ${fileIdsToUpload.length} 个文件`);
    } else {
      message.warning("没有待上传或已暂停的文件");
    }
  }, [sortedFiles, fileConcurrency]);

  // 暂停队列
  const toggleQueuePause = useCallback(() => {
    if (queuePaused) {
      resumeQueue();
      setQueuePaused(false);
      message.info("队列已恢复");
    } else {
      pauseQueue(); // Use pauseQueue to pause the entire queue
      setQueuePaused(true);
      message.info("队列已暂停");
    }
  }, [queuePaused]);

  // 清空所有文件
  const handleClearQueue = useCallback(() => {
    // 清空store中的所有文件
    clearAllFiles();
    message.success("队列已清空");
  }, [clearAllFiles]);

  // 暂停队列中的所有文件
  const handlePauseAll = useCallback(() => {
    pauseQueue();
  }, []);

  // 恢复队列中的所有文件
  const handleResumeAll = useCallback(() => {
    resumeQueue();
  }, []);

  // 重试所有失败的文件
  const handleRetryAllFailed = useCallback(() => {
    const failedFileIds = errorFiles.map((file) => file.id);
    if (failedFileIds.length > 0) {
      // 确保队列处于启动状态
      const queueStats = getQueueStats();
      if (queueStats.isPaused) {
        resumeQueue();
      }
      // 根据网络状态更新文件上传队列的并发数
      updateQueueConcurrency(fileConcurrency);
      uploadFilesInSequence(failedFileIds);
      message.success(`开始重试 ${failedFileIds.length} 个失败文件`);
    } else {
      message.warning("没有失败文件需要重试");
    }
  }, [errorFiles, fileConcurrency]);

  // 监听网络状态变化，更新队列并发数
  useEffect(() => {
    // updateChunkConcurrency(networkType);
    console.log(
      "[DEBUG] useNetworkType 计算的 fileConcurrency:",
      fileConcurrency
    );
  }, [networkType, fileConcurrency]);

  return {
    queuePaused,
    isOffline: networkType === "offline",
    uploadingFiles,
    pendingFiles,
    pausedFiles,
    uploadFiles,
    handleUpload,
    toggleQueuePause,
    handleRetryAllFailed,
    handleClearQueue,
    handlePauseAll,
    handleResumeAll,
    totalPendingCount,
    totalFailedCount,
  };
};
