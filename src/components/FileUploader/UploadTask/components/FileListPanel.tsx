import "./FileListPanel.css";

import { Button, Space, Table } from "antd";
import React, { useCallback } from "react";
import {
  addFileToQueue,
  pauseFile,
  resumeFile,
  retryUpload,
} from "../services/uploadService";

import { ReloadOutlined } from "@ant-design/icons";
import { UploadStatus } from "../types/upload";
import { createFileListColumns } from "./FileListColumns";
import { useTableHeight } from "../hooks/useTableHeight";
import { useUploadStore } from "../store/uploadStore";

const FileListPanel: React.FC = () => {
  // 使用选择器函数分别获取状态和动作，避免不必要的重新渲染
  const uploadFiles = useUploadStore((state) => state.uploadFiles);
  const removeFile = useUploadStore((state) => state.removeFile);
  const clearCompleted = useUploadStore((state) => state.clearCompleted);

  // 使用自定义 Hook 计算表格高度
  const tableHeight = useTableHeight();

  // 按照创建时间排序，最早的在前面
  const sortedFiles = React.useMemo(() => {
    return [...uploadFiles].sort((a, b) => a.createdAt - b.createdAt);
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

  const handlePauseFile = useCallback((fileId: string) => {
    pauseFile(fileId);
  }, []);

  const handleResumeFile = useCallback((fileId: string) => {
    resumeFile(fileId);
  }, []);

  // 创建表格列配置
  const columns = React.useMemo(
    () =>
      createFileListColumns({
        handleRetry,
        handleRemove,
        handleUploadFile,
        handlePauseFile,
        handleResumeFile,
      }),
    [
      handleRetry,
      handleRemove,
      handleUploadFile,
      handlePauseFile,
      handleResumeFile,
    ]
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

      <div className="file-list-table-container">
        <Table
          dataSource={sortedFiles}
          columns={columns}
          rowKey="id"
          pagination={false}
          size="middle"
          scroll={{ y: tableHeight }}
          virtual
          rowClassName={(_, index) =>
            index % 2 === 0 ? "table-row-light" : "table-row-dark"
          }
          className="virtual-table"
        />
      </div>
    </div>
  );
};

export default FileListPanel;
