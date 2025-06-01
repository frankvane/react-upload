import * as dbService from "../services/dbService";

import { Alert, Badge, Button, Space, Tooltip, message } from "antd";
import {
  ClearOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  WifiOutlined,
} from "@ant-design/icons";
import React, { useEffect, useState } from "react";
import {
  addFileToQueue,
  clearQueue,
  getQueueStats,
  pauseQueue,
  resumeQueue,
  updateQueueConcurrency,
} from "../services/uploadService";

import type { UploadFile } from "../store/uploadStore";
import { UploadStatus } from "../types/upload";
import { useNetworkType } from "../hooks/useNetworkType";
import { useUploadStore } from "../store/uploadStore";

// 合并FileListToolbar的属性
interface UploadButtonProps {
  // FileListToolbar属性
  hasUploadingFiles?: boolean;
  hasCompletedFiles?: boolean;
  failedFilesCount?: number;
  onUploadAll?: () => void;
  onRetryAllFailed?: () => void;
  onClearCompleted?: () => void;
  onJumpToFirstPage?: () => void;
  sortedFiles: UploadFile[];
}

const UploadButton: React.FC<UploadButtonProps> = ({
  // FileListToolbar属性，设置默认值
  hasUploadingFiles = false,
  hasCompletedFiles = false,
  failedFilesCount = 0,
  onUploadAll,
  onRetryAllFailed,
  onClearCompleted,
  onJumpToFirstPage,
  sortedFiles,
}) => {
  // 上传状态管理
  const [queuePaused, setQueuePaused] = useState<boolean>(false);

  // 保存暂停/中断前的待上传文件信息
  // 已由pausedAllFileIds取代，无需单独保存pending

  const uploadFiles = useUploadStore((state) => state.uploadFiles);
  const removeFile = useUploadStore((state) => state.removeFile);
  const resetFile = useUploadStore((state) => state.resetFile);

  // 使用网络状态 hook
  const { networkType, chunkSize, fileConcurrency, chunkConcurrency } =
    useNetworkType();

  // 是否处于离线状态
  const isOffline = networkType === "offline";

  // 监听网络状态变化，更新队列并发数
  useEffect(() => {
    updateQueueConcurrency(fileConcurrency);
    // 当网络离线时显示提示
    if (isOffline) {
      message.warning("网络已断开，上传功能将暂时不可用");
    }
  }, [networkType, chunkSize, fileConcurrency, chunkConcurrency, isOffline]);

  // 获取所有处于 QUEUED_FOR_UPLOAD 状态的文件
  const pendingFiles = uploadFiles.filter(
    (file) => file.status === UploadStatus.QUEUED_FOR_UPLOAD
  );

  // 获取所有正在上传的文件
  const uploadingFiles = uploadFiles.filter(
    (file) =>
      file.status === UploadStatus.QUEUED ||
      file.status === UploadStatus.CALCULATING ||
      file.status === UploadStatus.PREPARING_UPLOAD ||
      file.status === UploadStatus.UPLOADING
  );

  // 获取所有暂停状态的文件
  const pausedFiles = uploadFiles.filter(
    (file) => file.status === UploadStatus.PAUSED
  );

  // 获取所有错误状态的文件
  const errorFiles = uploadFiles.filter(
    (file) =>
      file.status === UploadStatus.ERROR ||
      file.status === UploadStatus.MERGE_ERROR
  );

  // 处理上传按钮点击 - 合并上传文件和全部上传功能
  const handleUpload = () => {
    if (isOffline) {
      message.error("网络已断开，无法上传文件");
      return;
    }

    if (pendingFiles.length === 0) {
      message.warning("没有待上传的文件");
      return;
    }

    // 显示开始上传的信息
    message.success(
      `开始上传 ${pendingFiles.length} 个文件 (并发数: ${fileConcurrency})`
    );

    // 如果上传队列之前被暂停或中断，重置状态
    setQueuePaused(false);

    // 如果提供了onUploadAll回调，优先使用它（使用顺序上传）
    if (onUploadAll && typeof onUploadAll === "function") {
      onUploadAll();
      return;
    }

    // 否则使用原来的方式
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
  };

  // 暂停上传队列
  const handlePauseQueue = async () => {
    if (isOffline) {
      message.error("网络已断开，无法操作上传队列");
      return;
    }

    if (uploadingFiles.length === 0 && pendingFiles.length === 0) {
      message.warning("没有正在上传或待上传的文件");
      return;
    }

    // 暂停上传
    message.info("正在暂停上传队列...");

    // 暂停队列处理并暂停所有正在上传的文件
    pauseQueue();
    clearQueue();
    setQueuePaused(true);
  };

  // 恢复暂停的上传队列
  const handleResumeQueue = async () => {
    if (isOffline) {
      message.error("网络已断开，无法操作上传队列");
      return;
    }

    // 按当前UI排序顺序恢复上传
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

    // 顺序调度所有未完成文件，priority从大到小，保证第一个文件优先
    for (let i = 0; i < unfinishedFiles.length; i++) {
      const fileId = unfinishedFiles[i].id;
      resetFile(fileId);
      addFileToQueue(fileId, unfinishedFiles.length - i, fileConcurrency);
      if (i < unfinishedFiles.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    setQueuePaused(false);
    message.success(`已恢复上传队列 (并发数: ${fileConcurrency})`);
    if (typeof onJumpToFirstPage === "function") {
      onJumpToFirstPage();
    }
  };

  // 切换暂停/恢复上传队列
  const toggleQueuePause = async () => {
    if (queuePaused) {
      await handleResumeQueue();
    } else {
      await handlePauseQueue();
    }
  };

  // 清空队列
  const handleClearQueue = async () => {
    // 先清除队列中的任务
    clearQueue();

    // 清空 IndexedDB 中的所有文件数据
    try {
      await dbService.clearAllFileMeta();
    } catch (error) {
      console.error("清空 IndexedDB 失败:", error);
    }

    // 从状态中移除所有文件
    uploadFiles.forEach((file) => {
      removeFile(file.id);
    });

    // 重置UI状态
    setQueuePaused(false);

    message.success("已清空所有文件");
  };

  // 重试所有失败的文件 - 合并两个重试功能
  const handleRetryAllFailed = () => {
    if (isOffline) {
      message.error("网络已断开，无法重试失败的文件");
      return;
    }

    // 获取所有错误状态的文件
    const errorAndAbortedFiles = uploadFiles.filter(
      (file) =>
        file.status === UploadStatus.ERROR ||
        file.status === UploadStatus.MERGE_ERROR
    );

    // 确定要重试的文件数量
    const retryCount = onRetryAllFailed
      ? failedFilesCount
      : errorAndAbortedFiles.length;

    if (retryCount === 0) {
      message.warning("没有失败或已中断的文件需要重试");
      return;
    }

    // 如果队列处于暂停状态，恢复队列
    if (queuePaused) {
      setQueuePaused(false);
    }

    // 显示开始重试的消息
    message.success(
      `开始重试 ${retryCount} 个失败或已中断的文件 (并发数: ${fileConcurrency})`
    );

    // 如果提供了onRetryAllFailed回调，优先使用它
    if (onRetryAllFailed && typeof onRetryAllFailed === "function") {
      onRetryAllFailed();
      return;
    }

    // 否则使用原来的方式
    const retryFilesWithDelay = async () => {
      // 确保队列处于启动状态
      const queueStats = getQueueStats();
      if (queueStats.isPaused) {
        resumeQueue(fileConcurrency);
      }

      for (let i = 0; i < errorAndAbortedFiles.length; i++) {
        const file = errorAndAbortedFiles[i];
        // 重置文件状态
        resetFile(file.id);
        // 添加到上传队列，并传递当前网络状态下的并发数
        addFileToQueue(file.id, fileConcurrency);

        if (i < errorAndAbortedFiles.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    };

    retryFilesWithDelay();
  };

  // 获取网络状态对应的颜色
  const getNetworkStatusColor = () => {
    if (networkType === "offline") return "#f5222d";
    if (networkType === "slow-2g" || networkType === "2g") return "#fa8c16";
    if (networkType === "3g") return "#faad14";
    if (
      networkType === "4g" ||
      networkType === "wifi" ||
      networkType === "ethernet"
    )
      return "#52c41a";
    return "#1677ff";
  };

  // 获取网络状态显示文本
  const getNetworkTypeDisplay = () => {
    if (networkType === "offline") return "离线";
    if (networkType === "wifi") return "WiFi";
    if (networkType === "ethernet") return "有线网络";
    return networkType.toUpperCase();
  };

  // 计算待上传文件总数
  const totalPendingCount = pendingFiles.length;

  // 计算失败文件总数
  const totalFailedCount = Math.max(errorFiles.length, failedFilesCount || 0);

  return (
    <>
      {isOffline && (
        <Alert
          message="网络已断开"
          description="当前处于离线状态，上传功能暂时不可用。请检查您的网络连接，待网络恢复后可继续上传。"
          type="error"
          showIcon
          icon={<DisconnectOutlined />}
          style={{ marginBottom: 16 }}
        />
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          alignItems: "center",
        }}
      >
        {/* 主要操作按钮 */}
        <Space wrap>
          {/* 上传文件按钮 */}
          <Tooltip title="上传文件">
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              onClick={handleUpload}
              disabled={totalPendingCount === 0 || isOffline || queuePaused}
              style={{ position: "relative", zIndex: 2 }}
            >
              {totalPendingCount > 0 && totalPendingCount}
            </Button>
          </Tooltip>

          {/* 暂停/恢复上传队列按钮 */}
          <Tooltip title={queuePaused ? "恢复上传" : "暂停上传"}>
            <Button
              icon={
                queuePaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />
              }
              onClick={toggleQueuePause}
              disabled={
                (uploadingFiles.length === 0 &&
                  pendingFiles.length === 0 &&
                  pausedFiles.length === 0) ||
                isOffline
              }
              type={queuePaused ? "primary" : "default"}
              style={{ position: "relative", zIndex: 2 }}
            />
          </Tooltip>

          {/* 重试失败或已中断文件按钮 */}
          {totalFailedCount > 0 && (
            <Tooltip title="重试失败或已中断文件">
              <Button
                type="primary"
                danger
                icon={<ReloadOutlined />}
                onClick={handleRetryAllFailed}
                disabled={isOffline || queuePaused}
                style={{ position: "relative", zIndex: 2 }}
              >
                {totalFailedCount}
              </Button>
            </Tooltip>
          )}

          {/* 清空队列按钮 */}
          <Tooltip title="清空队列">
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={handleClearQueue}
              disabled={uploadFiles.length === 0 || uploadingFiles.length > 0}
              style={{ position: "relative", zIndex: 2 }}
            />
          </Tooltip>

          {/* 清除已完成按钮 */}
          {hasCompletedFiles && (
            <Tooltip title="清除已完成">
              <Button
                danger
                icon={<ClearOutlined />}
                onClick={onClearCompleted}
                disabled={hasUploadingFiles}
                style={{ position: "relative", zIndex: 2 }}
              />
            </Tooltip>
          )}
        </Space>

        {/* 网络状态显示 */}
        <Space>
          <Tooltip
            title={`网络状态: ${getNetworkTypeDisplay()}
            ${
              !isOffline
                ? `切片大小: ${(chunkSize / (1024 * 1024)).toFixed(1)}MB
            文件并发: ${fileConcurrency}
            分片并发: ${chunkConcurrency}`
                : "网络已断开，无法上传文件"
            }`}
          >
            <Badge
              count={
                isOffline ? (
                  <DisconnectOutlined style={{ color: "#f5222d" }} />
                ) : (
                  <WifiOutlined style={{ color: getNetworkStatusColor() }} />
                )
              }
              size="small"
            >
              <Button
                type={isOffline ? "default" : "text"}
                danger={isOffline}
                style={{ position: "relative", zIndex: 2 }}
              >
                {getNetworkTypeDisplay()}
              </Button>
            </Badge>
          </Tooltip>
        </Space>
      </div>
    </>
  );
};

export default UploadButton;
