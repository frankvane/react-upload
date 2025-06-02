import "./FileListPanel.css";

import * as dbService from "../services/dbService";

import React, { useCallback, useEffect, useState } from "react";
import {
  getQueueStats,
  pauseFile,
  resumeFile,
  resumeQueue,
  retryUpload,
  useAutoPauseQueueOnNetworkChange,
} from "../services/uploadService";

import type { SorterResult } from "antd/es/table/interface";
import { Table } from "antd";
import UploadControls from "./UploadControls";
import type { UploadFile } from "../store/uploadStore";
import { UploadStatus } from "../types/upload";
import { createFileListColumns } from "./FileListColumns";
import { notification } from "antd";
import { useSortedUploadFiles } from "../hooks/useSortedUploadFiles";
import { useTableHeight } from "../hooks/useTableHeight";
import { useUploadFileStatus } from "../hooks/useUploadFileStatus";
import { useUploadStore } from "../store/uploadStore";

const FileListPanel: React.FC = () => {
  useAutoPauseQueueOnNetworkChange();

  // 使用选择器函数分别获取状态和动作，避免不必要的重新渲染
  const uploadFiles = useUploadStore((state) => state.uploadFiles);
  const removeFile = useUploadStore((state) => state.removeFile);
  const clearCompleted = useUploadStore((state) => state.clearCompleted);

  // 使用自定义 Hook 计算表格高度
  const tableHeight = useTableHeight();

  // 使用自定义 Hook 管理排序和排序状态
  const { sortedFiles, setSortState } = useSortedUploadFiles(uploadFiles);

  // 使用自定义 Hook 获取文件状态
  const { hasUploadingFiles, hasCompletedFiles } =
    useUploadFileStatus(sortedFiles);

  // 批量上传结果汇总通知
  const [notified, setNotified] = useState(false);
  useEffect(() => {
    const total = sortedFiles.length;
    const finished = sortedFiles.filter(
      (f) =>
        f.status === UploadStatus.DONE ||
        f.status === UploadStatus.INSTANT ||
        f.status === UploadStatus.ERROR ||
        f.status === UploadStatus.MERGE_ERROR
    ).length;

    if (total > 0 && finished === total && !notified) {
      const successCount = sortedFiles.filter(
        (f) =>
          f.status === UploadStatus.DONE || f.status === UploadStatus.INSTANT
      ).length;
      const failCount = sortedFiles.filter(
        (f) =>
          f.status === UploadStatus.ERROR ||
          f.status === UploadStatus.MERGE_ERROR
      ).length;

      notification.info({
        message: "批量上传完成",
        description: `成功：${successCount}，失败：${failCount}`,
        duration: 4,
      });

      setNotified(true);
    }
    if (finished < total) {
      setNotified(false);
    }
  }, [sortedFiles]);

  // 断点续传提示逻辑
  const [resumeInfo, setResumeInfo] = React.useState<string | null>(null);
  useEffect(() => {
    // 检查是否有文件处于断点续传状态
    const uploadingFile = sortedFiles.find(
      (f) => f.status === UploadStatus.UPLOADING
    );
    if (
      uploadingFile &&
      uploadingFile.chunkCount &&
      uploadingFile.uploadedChunks !== undefined
    ) {
      const skipped = uploadingFile.uploadedChunks || 0;
      const total = uploadingFile.chunkCount;
      if (skipped > 0 && skipped < total) {
        setResumeInfo(
          `断点续传：已跳过${skipped}个分片，补传${total - skipped}个分片`
        );
      } else {
        setResumeInfo(null);
      }
    } else {
      setResumeInfo(null);
    }
  }, [sortedFiles]);

  // 处理表格排序和分页变化
  const handleTableChange = (
    _filters: Record<string, any>,
    sorter: SorterResult<UploadFile> | SorterResult<UploadFile>[]
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
      console.log(`[DEBUG] 重试文件 ${fileId}`);

      // 确保队列处于启动状态
      const queueStats = getQueueStats();
      if (queueStats.isPaused) {
        console.log(`[DEBUG] 队列处于暂停状态，正在启动队列`);
        resumeQueue();
      }

      // 查找文件在当前排序列表中的位置
      const index = sortedFiles.findIndex((file) => file.id === fileId);
      const priority = index >= 0 ? 9999 - index : 0; // 优先级基于表格位置

      console.log(`[DEBUG] 重试文件 ${fileId}，优先级: ${priority}`);
      retryUpload(fileId, priority);

      // 确保文件状态被更新
      setTimeout(() => {
        const { uploadFiles } = useUploadStore.getState();
        const file = uploadFiles.find((f) => f.id === fileId);
        console.log(`[DEBUG] 重试后文件 ${fileId} 状态: ${file?.status}`);
      }, 500);
    },
    [sortedFiles]
  );

  const handleRemove = useCallback(
    (fileId: string) => {
      removeFile(fileId);
    },
    [removeFile]
  );

  const handleClearCompleted = useCallback(() => {
    clearCompleted();
  }, [clearCompleted]);

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
        handlePauseFile: handlePauseFile,
        handleResumeFile: handleResumeFile,
      }),
    [handleRetry, handleRemove, handlePauseFile, handleResumeFile]
  );

  // 缓存空间占用显示
  const [cacheSize, setCacheSize] = React.useState<number>(0);
  useEffect(() => {
    const fetchCacheSize = async () => {
      const size = await dbService.getTotalCacheSize();
      setCacheSize(size);
    };
    fetchCacheSize();
  }, [uploadFiles]);

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
        <span style={{ color: "#888", fontSize: 13, marginLeft: 16 }}>
          本地缓存占用：{(cacheSize / (1024 * 1024)).toFixed(2)} MB
        </span>
        <UploadControls
          hasUploadingFiles={hasUploadingFiles}
          hasCompletedFiles={hasCompletedFiles}
          onClearCompleted={handleClearCompleted}
        />
      </div>
      {resumeInfo && (
        <div style={{ color: "#faad14", marginBottom: 8, fontWeight: 500 }}>
          {resumeInfo}
        </div>
      )}

      <div className="file-list-table-container">
        <Table
          dataSource={sortedFiles}
          columns={columns}
          rowKey="id"
          pagination={false}
          size="middle"
          virtual
          scroll={{ y: tableHeight }}
          rowClassName={(_, index) =>
            index % 2 === 0 ? "table-row-light" : "table-row-dark"
          }
          className="virtual-table"
          onChange={handleTableChange}
        />
      </div>
    </div>
  );
};

export default FileListPanel;
