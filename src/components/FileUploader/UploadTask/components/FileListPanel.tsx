import { Button, Progress, Space, Table, Tag, Tooltip } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  SyncOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import React, { useCallback } from "react";
import { addFileToQueue, retryUpload } from "../services/uploadService";

import type { UploadFile } from "../store/uploadStore";
import { UploadStatus } from "../types/upload";
import { useUploadStore } from "../store/uploadStore";

// 格式化文件大小
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// 根据上传状态获取状态标签
const getStatusTag = (status: UploadStatus): JSX.Element => {
  switch (status) {
    case UploadStatus.QUEUED:
      return (
        <Tag color="default" icon={<PauseCircleOutlined />}>
          排队中
        </Tag>
      );
    case UploadStatus.QUEUED_FOR_UPLOAD:
      return (
        <Tag color="default" icon={<PauseCircleOutlined />}>
          等待上传
        </Tag>
      );
    case UploadStatus.CALCULATING:
      return (
        <Tag color="processing" icon={<SyncOutlined spin />}>
          计算中
        </Tag>
      );
    case UploadStatus.UPLOADING:
      return (
        <Tag color="processing" icon={<LoadingOutlined />}>
          上传中
        </Tag>
      );
    case UploadStatus.DONE:
      return (
        <Tag color="success" icon={<CheckCircleOutlined />}>
          已完成
        </Tag>
      );
    case UploadStatus.INSTANT:
      return (
        <Tag color="success" icon={<CheckCircleOutlined />}>
          秒传
        </Tag>
      );
    case UploadStatus.ERROR:
      return (
        <Tag color="error" icon={<CloseCircleOutlined />}>
          失败
        </Tag>
      );
    case UploadStatus.MERGE_ERROR:
      return (
        <Tag color="error" icon={<CloseCircleOutlined />}>
          合并失败
        </Tag>
      );
    default:
      return <Tag color="default">未知</Tag>;
  }
};

const FileListPanel: React.FC = () => {
  // 使用选择器函数分别获取状态和动作，避免不必要的重新渲染
  const uploadFiles = useUploadStore((state) => state.uploadFiles);
  const removeFile = useUploadStore((state) => state.removeFile);
  const clearCompleted = useUploadStore((state) => state.clearCompleted);

  // 按照创建时间排序，最新的在前面
  const sortedFiles = React.useMemo(() => {
    return [...uploadFiles].sort((a, b) => b.createdAt - a.createdAt);
  }, [uploadFiles]);

  // 检查是否有正在上传的文件
  const hasUploadingFiles = React.useMemo(() => {
    return uploadFiles.some(
      (file) =>
        file.status === UploadStatus.QUEUED ||
        file.status === UploadStatus.CALCULATING ||
        file.status === UploadStatus.UPLOADING
    );
  }, [uploadFiles]);

  // 检查是否有失败的文件
  const failedFiles = React.useMemo(() => {
    return uploadFiles.filter(
      (file) =>
        file.status === UploadStatus.ERROR ||
        file.status === UploadStatus.MERGE_ERROR
    );
  }, [uploadFiles]);

  const handleRetry = useCallback((fileId: string) => {
    retryUpload(fileId);
  }, []);

  const handleRemove = useCallback(
    (fileId: string) => {
      removeFile(fileId);
    },
    [removeFile]
  );

  const handleUploadFile = useCallback((fileId: string) => {
    addFileToQueue(fileId);
  }, []);

  const handleClearCompleted = useCallback(() => {
    clearCompleted();
  }, [clearCompleted]);

  // 重试所有失败的文件
  const handleRetryAllFailed = useCallback(() => {
    failedFiles.forEach((file) => {
      retryUpload(file.id);
    });
  }, [failedFiles]);

  const columns = React.useMemo(
    () => [
      {
        title: "文件名",
        dataIndex: "file",
        key: "fileName",
        render: (file: File) => file.name,
        width: "30%",
      },
      {
        title: "大小",
        dataIndex: "file",
        key: "fileSize",
        render: (file: File) => formatFileSize(file.size),
        width: "15%",
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        render: (status: UploadStatus, record: UploadFile) => (
          <Tooltip title={record.errorMessage}>{getStatusTag(status)}</Tooltip>
        ),
        width: "15%",
      },
      {
        title: "进度",
        key: "progress",
        render: (_: unknown, record: UploadFile) => {
          if (
            record.status === UploadStatus.DONE ||
            record.status === UploadStatus.INSTANT
          ) {
            return <Progress percent={100} size="small" status="success" />;
          }
          if (
            record.status === UploadStatus.ERROR ||
            record.status === UploadStatus.MERGE_ERROR
          ) {
            return (
              <Progress
                percent={record.progress}
                size="small"
                status="exception"
              />
            );
          }
          if (record.status === UploadStatus.CALCULATING) {
            return (
              <Tooltip title={`MD5计算进度: ${record.progress}%`}>
                <Progress
                  percent={record.progress}
                  size="small"
                  strokeColor="#1890ff"
                  trailColor="#e6f7ff"
                  status="active"
                />
              </Tooltip>
            );
          }
          return <Progress percent={record.progress} size="small" />;
        },
        width: "20%",
      },
      {
        title: "操作",
        key: "action",
        render: (_: unknown, record: UploadFile) => (
          <Space size="middle">
            {record.status === UploadStatus.QUEUED_FOR_UPLOAD && (
              <Button
                type="link"
                icon={<UploadOutlined />}
                onClick={() => handleUploadFile(record.id)}
                size="small"
              >
                上传
              </Button>
            )}
            {(record.status === UploadStatus.ERROR ||
              record.status === UploadStatus.MERGE_ERROR) && (
              <Button
                type="link"
                icon={<ReloadOutlined />}
                onClick={() => handleRetry(record.id)}
                size="small"
              >
                重试
              </Button>
            )}
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleRemove(record.id)}
              size="small"
            >
              删除
            </Button>
          </Space>
        ),
        width: "20%",
      },
    ],
    [handleRetry, handleRemove, handleUploadFile]
  );

  // 检查是否有已完成的文件
  const hasCompletedFiles = React.useMemo(() => {
    return sortedFiles.some(
      (file) =>
        file.status === UploadStatus.DONE ||
        file.status === UploadStatus.INSTANT
    );
  }, [sortedFiles]);

  return (
    <div style={{ marginTop: "20px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <h3 style={{ margin: 0 }}>上传列表 ({sortedFiles.length})</h3>
        <Space>
          {failedFiles.length > 0 && (
            <Button
              type="link"
              icon={<ReloadOutlined />}
              onClick={handleRetryAllFailed}
              size="small"
              disabled={hasUploadingFiles}
            >
              全部重试 ({failedFiles.length})
            </Button>
          )}
          {hasCompletedFiles && (
            <Button
              type="link"
              onClick={handleClearCompleted}
              size="small"
              disabled={hasUploadingFiles}
            >
              清除已完成
            </Button>
          )}
        </Space>
      </div>

      <Table
        dataSource={sortedFiles}
        columns={columns}
        rowKey="id"
        pagination={false}
        size="middle"
      />
    </div>
  );
};

export default FileListPanel;
