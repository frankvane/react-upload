import * as dbService from "../services/dbService";

import { Alert, Badge, Button, Space, Tooltip, message } from "antd";
import {
  CloudUploadOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  WifiOutlined,
} from "@ant-design/icons";
import React, { useEffect, useState } from "react";
import {
  addFileToQueue,
  clearQueue,
  pauseQueue,
  resumeQueue,
  updateQueueConcurrency,
} from "../services/uploadService";

import { UploadStatus } from "../types/upload";
import { useNetworkType } from "../hooks/useNetworkType";
import { useUploadStore } from "../store/uploadStore";

const UploadButton: React.FC = () => {
  const [queuePaused, setQueuePaused] = useState<boolean>(false);
  const uploadFiles = useUploadStore((state) => state.uploadFiles);
  const removeFile = useUploadStore((state) => state.removeFile);

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

  // 获取所有错误状态的文件
  const errorFiles = uploadFiles.filter(
    (file) =>
      file.status === UploadStatus.ERROR ||
      file.status === UploadStatus.MERGE_ERROR
  );

  // 处理上传按钮点击
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

    // 创建一个延迟添加的函数，避免同时添加太多文件到队列造成阻塞
    const addFilesWithDelay = async () => {
      // 将所有待上传文件添加到上传队列，每个文件间隔100毫秒添加
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        addFileToQueue(file.id, fileConcurrency);

        // 每添加一个文件，等待100毫秒，避免过度阻塞
        if (i < pendingFiles.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    };

    // 开始执行添加文件的流程
    addFilesWithDelay();
  };

  // 暂停/恢复上传队列
  const toggleQueuePause = async () => {
    if (isOffline) {
      message.error("网络已断开，无法操作上传队列");
      return;
    }

    if (queuePaused) {
      await resumeQueue(fileConcurrency);
      setQueuePaused(false);
      message.info(`已恢复上传队列 (并发数: ${fileConcurrency})`);
    } else {
      pauseQueue();
      setQueuePaused(true);
      message.info("已暂停上传队列");
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

    message.success("已清空所有文件");
  };

  // 重试所有失败的文件
  const handleRetryAllFailed = () => {
    if (isOffline) {
      message.error("网络已断开，无法重试失败的文件");
      return;
    }

    if (errorFiles.length === 0) {
      message.warning("没有失败的文件需要重试");
      return;
    }

    // 显示开始重试的消息
    message.success(
      `开始重试 ${errorFiles.length} 个失败的文件 (并发数: ${fileConcurrency})`
    );

    // 创建一个延迟添加的函数，避免同时添加太多文件到队列造成阻塞
    const retryFilesWithDelay = async () => {
      // 将所有失败的文件重新添加到上传队列，每个文件间隔100毫秒添加
      for (let i = 0; i < errorFiles.length; i++) {
        const file = errorFiles[i];
        // 重置文件状态
        useUploadStore.getState().resetFile(file.id);
        // 添加到上传队列，并传递当前网络状态下的并发数
        addFileToQueue(file.id, fileConcurrency);

        // 每添加一个文件，等待100毫秒，避免过度阻塞
        if (i < errorFiles.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    };

    // 开始执行重试文件的流程
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

      <Space wrap>
        <Button
          type="primary"
          icon={<CloudUploadOutlined />}
          onClick={handleUpload}
          disabled={pendingFiles.length === 0 || isOffline}
        >
          上传文件 {pendingFiles.length > 0 ? `(${pendingFiles.length})` : ""}
        </Button>

        <Button
          icon={queuePaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
          onClick={toggleQueuePause}
          disabled={uploadingFiles.length === 0 || isOffline}
          type={queuePaused ? "primary" : "default"}
        >
          {queuePaused ? "恢复上传" : "暂停上传"}
        </Button>

        {errorFiles.length > 0 && (
          <Button
            type="primary"
            danger
            onClick={handleRetryAllFailed}
            disabled={isOffline}
          >
            全部重试 ({errorFiles.length})
          </Button>
        )}

        <Button
          danger
          icon={<DeleteOutlined />}
          onClick={handleClearQueue}
          disabled={uploadFiles.length === 0 || uploadingFiles.length > 0}
        >
          清空队列
        </Button>

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
            <Button type="text" danger={isOffline}>
              {getNetworkTypeDisplay()}
            </Button>
          </Badge>
        </Tooltip>
      </Space>
    </>
  );
};

export default UploadButton;
