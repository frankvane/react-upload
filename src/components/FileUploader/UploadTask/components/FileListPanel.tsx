import "./FileListPanel.css";

import { Button, Space, Table } from "antd";
import type {
  FilterValue,
  SortOrder,
  SorterResult,
  TableCurrentDataSource,
  TablePaginationConfig,
} from "antd/es/table/interface";
import React, { useCallback, useState } from "react";
import {
  addFileToQueue,
  pauseFile,
  resumeFile,
  retryUpload,
  uploadFilesInSequence,
} from "../services/uploadService";

import { ReloadOutlined } from "@ant-design/icons";
import type { UploadFile } from "../store/uploadStore";
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

  // 添加排序状态
  const [sortState, setSortState] = useState<{
    order: "ascend" | "descend" | undefined;
    columnKey: React.Key | undefined;
  }>({
    order: "ascend",
    columnKey: "createdAt",
  });

  // 根据排序状态对文件进行排序
  const sortedFiles = React.useMemo(() => {
    const files = [...uploadFiles];

    // 默认按创建时间升序排列（最早的在前面）
    if (!sortState.columnKey || sortState.columnKey === "createdAt") {
      return files.sort((a, b) => {
        const result = a.createdAt - b.createdAt;
        return sortState.order === "ascend" ? result : -result;
      });
    }

    // 按文件名排序
    if (sortState.columnKey === "fileName") {
      return files.sort((a, b) => {
        const result = a.file.name.localeCompare(b.file.name);
        return sortState.order === "ascend" ? result : -result;
      });
    }

    // 按文件大小排序
    if (sortState.columnKey === "fileSize") {
      return files.sort((a, b) => {
        const result = a.file.size - b.file.size;
        return sortState.order === "ascend" ? result : -result;
      });
    }

    // 按状态排序
    if (sortState.columnKey === "status") {
      return files.sort((a, b) => {
        const result = a.status.localeCompare(b.status);
        return sortState.order === "ascend" ? result : -result;
      });
    }

    // 按进度排序
    if (sortState.columnKey === "progress") {
      return files.sort((a, b) => {
        const result = a.progress - b.progress;
        return sortState.order === "ascend" ? result : -result;
      });
    }

    return files;
  }, [uploadFiles, sortState]);

  // 处理表格排序变化
  const handleTableChange = (
    _pagination: TablePaginationConfig,
    _filters: Record<string, FilterValue | null>,
    sorter: SorterResult<UploadFile> | SorterResult<UploadFile>[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _extra: TableCurrentDataSource<UploadFile>
  ) => {
    const sorterResult = Array.isArray(sorter) ? sorter[0] : sorter;
    setSortState({
      order:
        sorterResult.order === "ascend" || sorterResult.order === "descend"
          ? sorterResult.order
          : undefined,
      columnKey: sorterResult.columnKey,
    });
  };

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

  const handleRetry = useCallback(
    (fileId: string) => {
      // 查找文件在当前排序列表中的位置
      const index = sortedFiles.findIndex((file) => file.id === fileId);
      const priority = index >= 0 ? 9999 - index : 0; // 优先级基于表格位置
      retryUpload(fileId, priority);
    },
    [sortedFiles]
  );

  const handleRemove = useCallback(
    (fileId: string) => {
      removeFile(fileId);
    },
    [removeFile]
  );

  const handleUploadFile = useCallback(
    (fileId: string) => {
      // 查找文件在当前排序列表中的位置
      const index = sortedFiles.findIndex((file) => file.id === fileId);
      const priority = index >= 0 ? 9999 - index : 0; // 优先级基于表格位置
      addFileToQueue(fileId, priority);
    },
    [sortedFiles]
  );

  const handleClearCompleted = useCallback(() => {
    clearCompleted();
  }, [clearCompleted]);

  // 重试所有失败的文件
  const handleRetryAllFailed = useCallback(() => {
    // 按照当前排序顺序重试失败的文件
    const failedFilesInOrder = sortedFiles.filter(
      (file) =>
        file.status === UploadStatus.ERROR ||
        file.status === UploadStatus.MERGE_ERROR
    );

    // 获取文件ID数组
    const fileIds = failedFilesInOrder.map((file) => file.id);

    // 使用顺序上传功能
    if (fileIds.length > 0) {
      uploadFilesInSequence(fileIds);
    }
  }, [sortedFiles]);

  const handlePauseFile = useCallback((fileId: string) => {
    pauseFile(fileId);
  }, []);

  const handleResumeFile = useCallback(
    (fileId: string) => {
      // 查找文件在当前排序列表中的位置
      const index = sortedFiles.findIndex((file) => file.id === fileId);
      const priority = index >= 0 ? 9999 - index : 0; // 优先级基于表格位置
      resumeFile(fileId, priority);
    },
    [sortedFiles]
  );

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

  // 批量上传所有等待中的文件
  const handleUploadAll = useCallback(() => {
    // 按照当前表格顺序获取等待上传的文件
    const waitingFiles = sortedFiles.filter(
      (file) => file.status === UploadStatus.QUEUED_FOR_UPLOAD
    );

    // 获取文件ID数组
    const fileIds = waitingFiles.map((file) => file.id);

    console.log(
      "按当前顺序上传文件：",
      waitingFiles.map((f) => f.file.name)
    );

    // 使用顺序上传功能
    if (fileIds.length > 0) {
      uploadFilesInSequence(fileIds);
    }
  }, [sortedFiles]);

  // 检查是否有等待上传的文件
  const hasWaitingFiles = React.useMemo(() => {
    return sortedFiles.some(
      (file) => file.status === UploadStatus.QUEUED_FOR_UPLOAD
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
          {hasWaitingFiles && (
            <Button
              type="primary"
              onClick={handleUploadAll}
              size="small"
              disabled={hasUploadingFiles}
            >
              全部上传
            </Button>
          )}
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
          onChange={handleTableChange}
          sortDirections={["ascend", "descend"] as SortOrder[]}
        />
      </div>
    </div>
  );
};

export default FileListPanel;
