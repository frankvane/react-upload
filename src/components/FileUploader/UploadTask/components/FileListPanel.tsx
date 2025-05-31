import "./FileListPanel.css";

import { Button, Space, Table } from "antd";
import type {
  FilterValue,
  SortOrder,
  SorterResult,
  TableCurrentDataSource,
  TablePaginationConfig,
} from "antd/es/table/interface";
import React, { useCallback } from "react";
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
import { useSortedUploadFiles } from "../hooks/useSortedUploadFiles";
import { useTableHeight } from "../hooks/useTableHeight";
import { useUploadFileStatus } from "../hooks/useUploadFileStatus";
import { useUploadStore } from "../store/uploadStore";

const FileListPanel: React.FC = () => {
  // 使用选择器函数分别获取状态和动作，避免不必要的重新渲染
  const uploadFiles = useUploadStore((state) => state.uploadFiles);
  const removeFile = useUploadStore((state) => state.removeFile);
  const clearCompleted = useUploadStore((state) => state.clearCompleted);

  // 使用自定义 Hook 计算表格高度
  const tableHeight = useTableHeight();

  // 使用自定义 Hook 管理排序和排序状态
  const { sortedFiles, setSortState } = useSortedUploadFiles(uploadFiles);

  // 使用自定义 Hook 获取文件状态
  const { hasUploadingFiles, hasCompletedFiles, hasWaitingFiles, failedFiles } =
    useUploadFileStatus(sortedFiles);

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
