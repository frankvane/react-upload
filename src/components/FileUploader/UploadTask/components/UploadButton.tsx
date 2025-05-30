import * as dbService from "../services/dbService";

import { Button, Space, message } from "antd";
import {
  CloudUploadOutlined,
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import React, { useState } from "react";
import {
  addFileToQueue,
  clearQueue,
  pauseQueue,
  resumeQueue,
} from "../services/uploadService";

import { UploadStatus } from "../types/upload";
import { useUploadStore } from "../store/uploadStore";

const UploadButton: React.FC = () => {
  const [queuePaused, setQueuePaused] = useState<boolean>(false);
  const uploadFiles = useUploadStore((state) => state.uploadFiles);
  const removeFile = useUploadStore((state) => state.removeFile);

  // 获取所有处于 QUEUED_FOR_UPLOAD 状态的文件
  const pendingFiles = uploadFiles.filter(
    (file) => file.status === UploadStatus.QUEUED_FOR_UPLOAD
  );

  // 获取所有正在上传的文件
  const uploadingFiles = uploadFiles.filter(
    (file) =>
      file.status === UploadStatus.QUEUED ||
      file.status === UploadStatus.CALCULATING ||
      file.status === UploadStatus.UPLOADING
  );

  // 处理上传按钮点击
  const handleUpload = () => {
    if (pendingFiles.length === 0) {
      message.warning("没有待上传的文件");
      return;
    }

    // 将所有待上传文件添加到上传队列
    pendingFiles.forEach((file) => {
      addFileToQueue(file.id);
    });

    message.success(`开始上传 ${pendingFiles.length} 个文件`);
  };

  // 暂停/恢复上传队列
  const toggleQueuePause = () => {
    if (queuePaused) {
      resumeQueue();
      setQueuePaused(false);
      message.info("已恢复上传队列");
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

  return (
    <Space>
      <Button
        type="primary"
        icon={<CloudUploadOutlined />}
        onClick={handleUpload}
        disabled={pendingFiles.length === 0}
      >
        上传文件 {pendingFiles.length > 0 ? `(${pendingFiles.length})` : ""}
      </Button>

      <Button
        icon={queuePaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
        onClick={toggleQueuePause}
        disabled={uploadingFiles.length === 0}
        type={queuePaused ? "primary" : "default"}
      >
        {queuePaused ? "恢复上传" : "暂停上传"}
      </Button>

      <Button
        danger
        icon={<DeleteOutlined />}
        onClick={handleClearQueue}
        disabled={uploadFiles.length === 0 || uploadingFiles.length > 0}
      >
        清空队列
      </Button>
    </Space>
  );
};

export default UploadButton;
