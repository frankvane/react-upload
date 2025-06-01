import "./FileListPanel.css";

import * as dbService from "../services/dbService";

import type {
  FilterValue,
  SortOrder,
  SorterResult,
  TableCurrentDataSource,
  TablePaginationConfig,
} from "antd/es/table/interface";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  addFileToQueue,
  pauseFile,
  resumeFile,
  retryUpload,
  uploadFilesInSequence,
  useAutoPauseQueueOnNetworkChange,
} from "../services/uploadService";
import { message, notification } from "antd";

import { Table } from "antd";
import UploadButton from "./UploadButton";
import type { UploadFile } from "../store/uploadStore";
import { UploadStatus } from "../types/upload";
import { createFileListColumns } from "./FileListColumns";
import { useSortedUploadFiles } from "../hooks/useSortedUploadFiles";
import { useTableHeight } from "../hooks/useTableHeight";
import { useUploadFileStatus } from "../hooks/useUploadFileStatus";
import { useUploadStore } from "../store/uploadStore";

const FileListPanel: React.FC = () => {
  useAutoPauseQueueOnNetworkChange();

  // 添加分页配置
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 10, // 默认每页显示10条
    showSizeChanger: true,
    pageSizeOptions: ["10", "20", "50", "100"],
    showTotal: (total) => `共 ${total} 条记录`,
  });

  // 使用refs防止无限循环更新
  const paginationRef = useRef(pagination);
  const autoPageChangeRef = useRef(false); // 标记是否处于自动翻页状态
  const processingPageChangeRef = useRef(false); // 标记是否正在处理页面更改

  // 当pagination状态更新时同步到ref
  useEffect(() => {
    paginationRef.current = pagination;
  }, [pagination]);

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

  // 批量上传结果汇总通知
  const prevUploadCountRef = useRef<number>(0);
  const notifiedRef = useRef<boolean>(false);
  useEffect(() => {
    const total = sortedFiles.length;
    const finished = sortedFiles.filter(
      (f) =>
        f.status === UploadStatus.DONE ||
        f.status === UploadStatus.INSTANT ||
        f.status === UploadStatus.ERROR ||
        f.status === UploadStatus.MERGE_ERROR
    ).length;

    if (
      total > 0 &&
      finished === total &&
      !notifiedRef.current &&
      total !== prevUploadCountRef.current
    ) {
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

      notifiedRef.current = true;
      prevUploadCountRef.current = total;
    }
    if (finished < total) {
      notifiedRef.current = false;
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

  // 当前页的上传进度监控 - 使用防抖动和状态追踪防止无限循环
  useEffect(() => {
    // 避免在正在处理页面更改时再次触发
    if (processingPageChangeRef.current || autoPageChangeRef.current) return;

    // 如果没有上传中的文件或等待上传的文件，就不需要检查翻页
    if (!hasUploadingFiles && !hasWaitingFiles) return;

    // 获取当前分页信息
    const { current = 1, pageSize = 10 } = paginationRef.current;
    const startIndex = (current - 1) * pageSize;
    const endIndex = current * pageSize;

    // 确保索引在有效范围内
    if (startIndex >= sortedFiles.length) return;

    // 获取当前页文件
    const currentPageFiles = sortedFiles.slice(
      startIndex,
      Math.min(endIndex, sortedFiles.length)
    );

    // 检查当前页是否还有正在上传或等待上传的文件
    const hasCurrentPageUploading = currentPageFiles.some(
      (file) =>
        file.status === UploadStatus.UPLOADING ||
        file.status === UploadStatus.QUEUED_FOR_UPLOAD ||
        file.status === UploadStatus.QUEUED ||
        file.status === UploadStatus.CALCULATING
    );

    // 检查是否有下一页
    const hasNextPage = sortedFiles.length > endIndex;

    // 如果当前页没有正在上传的文件，但是有下一页，则自动跳转到下一页
    if (!hasCurrentPageUploading && hasNextPage) {
      // 检查下一页是否有待上传文件
      const nextPageFiles = sortedFiles.slice(
        endIndex,
        Math.min(endIndex + pageSize, sortedFiles.length)
      );
      const hasNextPagePendingFiles = nextPageFiles.some(
        (file) =>
          file.status === UploadStatus.QUEUED_FOR_UPLOAD ||
          file.status === UploadStatus.QUEUED
      );

      if (hasNextPagePendingFiles) {
        // 标记为自动翻页状态，防止重复触发
        autoPageChangeRef.current = true;
        processingPageChangeRef.current = true;

        // 延迟执行以避免频繁更新
        setTimeout(() => {
          // 自动翻到下一页
          setPagination((prev) => {
            const newPagination = {
              ...prev,
              current: current + 1,
            };
            paginationRef.current = newPagination;
            return newPagination;
          });

          // 上传下一页中的待上传文件
          const pendingFileIds = nextPageFiles
            .filter((file) => file.status === UploadStatus.QUEUED_FOR_UPLOAD)
            .map((file) => file.id);

          if (pendingFileIds.length > 0) {
            // 等待一段时间后开始上传
            setTimeout(() => {
              uploadFilesInSequence(pendingFileIds);
              // 重置标记
              processingPageChangeRef.current = false;
              autoPageChangeRef.current = false;
            }, 300);
          } else {
            // 重置标记
            processingPageChangeRef.current = false;
            autoPageChangeRef.current = false;
          }
        }, 100);
      }
    }
  }, [sortedFiles, hasUploadingFiles, hasWaitingFiles]);

  // 处理表格排序和分页变化
  const handleTableChange = (
    paginationConfig: TablePaginationConfig,
    _filters: Record<string, FilterValue | null>,
    sorter: SorterResult<UploadFile> | SorterResult<UploadFile>[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _extra: TableCurrentDataSource<UploadFile>
  ) => {
    // 只有非自动翻页状态下才更新分页
    if (!autoPageChangeRef.current) {
      setPagination(paginationConfig);
      paginationRef.current = paginationConfig;
    }

    // 更新排序状态
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

  // 批量上传所有等待中的文件
  const handleUploadAll = useCallback(() => {
    // 确保从第一页开始上传
    setPagination((prev) => {
      const newPagination = {
        ...prev,
        current: 1,
      };
      paginationRef.current = newPagination;
      return newPagination;
    });

    // 获取所有等待上传的文件，不仅仅是第一页
    const waitingFiles = sortedFiles.filter(
      (file) => file.status === UploadStatus.QUEUED_FOR_UPLOAD
    );

    // 获取文件ID数组
    const fileIds = waitingFiles.map((file) => file.id);

    // 显示开始上传的信息
    if (fileIds.length > 0) {
      message.success(`开始上传 ${fileIds.length} 个文件`);
      // 使用顺序上传功能
      uploadFilesInSequence(fileIds);
    } else {
      message.warning("没有待上传的文件");
    }
  }, [sortedFiles]);

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

    // 显示开始重试的消息
    if (fileIds.length > 0) {
      message.success(`开始重试 ${fileIds.length} 个失败的文件`);
      // 使用顺序上传功能
      uploadFilesInSequence(fileIds);
    } else {
      message.warning("没有失败的文件需要重试");
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
        <UploadButton
          hasUploadingFiles={hasUploadingFiles}
          hasCompletedFiles={hasCompletedFiles}
          failedFilesCount={failedFiles.length}
          onUploadAll={handleUploadAll}
          onRetryAllFailed={handleRetryAllFailed}
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
          pagination={pagination}
          size="middle"
          scroll={{ y: tableHeight }}
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
