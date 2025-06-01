import "./FileListPanel.css";

import * as dbService from "../services/dbService";

import type {
  FilterValue,
  SortOrder,
  SorterResult,
  TablePaginationConfig,
} from "antd/es/table/interface";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  addFileToQueue,
  getQueueStats,
  pauseFile,
  resumeFile,
  resumeQueue,
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
  const prevFilesCountRef = useRef<number>(0); // 追踪文件数量变化

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
  const { hasUploadingFiles, hasCompletedFiles, failedFiles } =
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

  // 在组件中添加对文件添加的监听
  useEffect(() => {
    // 如果文件数量增加，说明有新文件被添加，将分页重置到第1页
    if (uploadFiles.length > prevFilesCountRef.current) {
      // 重置到第1页
      setPagination((prev) => {
        const newPagination = {
          ...prev,
          current: 1,
        };
        paginationRef.current = newPagination;
        return newPagination;
      });
    }

    // 更新文件数量引用
    prevFilesCountRef.current = uploadFiles.length;
  }, [uploadFiles.length]);

  // 标记用户是否手动切页，禁止自动跳页
  const [userPaging, setUserPaging] = useState(false);

  // 跳到第一页方法，供UploadButton调用
  const jumpToFirstPage = () => {
    setPagination((prev) => ({ ...prev, current: 1 }));
    setUserPaging(false); // 恢复后允许自动翻页
  };

  // 修改自动翻页逻辑，只有在自动上传时且未手动切页才自动翻页
  useEffect(() => {
    if (
      processingPageChangeRef.current ||
      autoPageChangeRef.current ||
      userPaging
    )
      return;
    if (!hasUploadingFiles) return;
    const { current = 1, pageSize = 10 } = paginationRef.current;
    const startIndex = (current - 1) * pageSize;
    const endIndex = current * pageSize;
    if (startIndex >= sortedFiles.length) return;
    const currentPageFiles = sortedFiles.slice(
      startIndex,
      Math.min(endIndex, sortedFiles.length)
    );
    const hasCurrentPageUploading = currentPageFiles.some(
      (file) =>
        file.status === UploadStatus.UPLOADING ||
        file.status === UploadStatus.QUEUED ||
        file.status === UploadStatus.CALCULATING
    );
    const hasNextPage = sortedFiles.length > endIndex;
    if (!hasCurrentPageUploading && hasNextPage) {
      const nextPageFiles = sortedFiles.slice(
        endIndex,
        Math.min(endIndex + pageSize, sortedFiles.length)
      );
      const hasNextPageUploadingFiles = nextPageFiles.some(
        (file) =>
          file.status === UploadStatus.QUEUED ||
          file.status === UploadStatus.UPLOADING ||
          file.status === UploadStatus.CALCULATING
      );
      if (hasNextPageUploadingFiles) {
        autoPageChangeRef.current = true;
        processingPageChangeRef.current = true;
        setTimeout(() => {
          setPagination((prev) => {
            const newPagination = { ...prev, current: current + 1 };
            paginationRef.current = newPagination;
            return newPagination;
          });
          setTimeout(() => {
            processingPageChangeRef.current = false;
            autoPageChangeRef.current = false;
          }, 300);
        }, 100);
      }
    }
  }, [sortedFiles, hasUploadingFiles, userPaging]);

  // 处理表格排序和分页变化
  const handleTableChange = (
    paginationConfig: TablePaginationConfig,
    _filters: Record<string, FilterValue | null>,
    sorter: SorterResult<UploadFile> | SorterResult<UploadFile>[]
  ) => {
    // 用户手动切页时，禁止自动跳页
    setUserPaging(true);
    setPagination(paginationConfig);
    paginationRef.current = paginationConfig;
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
    // 确保队列处于启动状态
    const queueStats = getQueueStats();
    if (queueStats.isPaused) {
      resumeQueue();
    }

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
    console.log(`[DEBUG] 重试所有失败或已中断的文件`);

    // 确保队列处于启动状态
    const queueStats = getQueueStats();
    if (queueStats.isPaused) {
      console.log(`[DEBUG] 队列处于暂停状态，正在启动队列`);
      resumeQueue();
    }

    // 按照当前排序顺序重试失败的文件
    const failedFilesInOrder = sortedFiles.filter(
      (file) =>
        file.status === UploadStatus.ERROR ||
        file.status === UploadStatus.MERGE_ERROR
    );

    console.log(
      `[DEBUG] 找到 ${failedFilesInOrder.length} 个失败或已中断的文件需要重试`
    );

    // 获取文件ID数组
    const fileIds = failedFilesInOrder.map((file) => file.id);

    // 显示开始重试的消息
    if (fileIds.length > 0) {
      message.success(`开始重试 ${fileIds.length} 个失败或已中断的文件`);
      console.log(`[DEBUG] 开始重试文件:`, fileIds);

      // 使用顺序上传功能
      uploadFilesInSequence(fileIds);
    } else {
      message.warning("没有失败或已中断的文件需要重试");
      console.log(`[DEBUG] 没有找到需要重试的文件`);
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
          onJumpToFirstPage={jumpToFirstPage}
          sortedFiles={sortedFiles}
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
