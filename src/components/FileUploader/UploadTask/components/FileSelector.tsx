import { Alert, Button, Progress } from "antd";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { UploadOutlined } from "@ant-design/icons";
import { message } from "antd";
import { processFileWithWorker } from "../utils/fileUtils";
import { useNetworkType } from "../hooks/useNetworkType";
import { useUploadStore } from "../store/uploadStore";

interface FileSelectorProps {
  accept?: string;
  multiple?: boolean;
  maxSize?: number; // 单位：MB
  autoUpload?: boolean; // 是否自动上传
}

interface ProcessingStats {
  total: number;
  processed: number;
  success: number;
  failed: number;
  oversized: number;
  startTime: number;
  endTime?: number;
  totalTime?: number;
}

const FileSelector: React.FC<FileSelectorProps> = ({
  accept = "*",
  multiple = true,
  maxSize = 1024, // 默认最大1GB
  autoUpload = false, // 默认不自动上传
}) => {
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStats, setProcessingStats] =
    useState<ProcessingStats | null>(null);

  // 使用refs来跟踪处理状态，避免频繁的状态更新
  const statsRef = useRef<ProcessingStats | null>(null);
  const progressRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const isProcessingRef = useRef<boolean>(false);

  // 使用网络状态 hook 获取当前网络状态和推荐的上传参数
  const { networkType, chunkSize, fileConcurrency } = useNetworkType();

  // 是否处于离线状态
  const isOffline = networkType === "offline";

  const addFile = useUploadStore((state) => state.addFile);
  const addFilesBatch = useUploadStore((state) => state.addFilesBatch);
  const useIndexedDB = useUploadStore((state) => state.useIndexedDB);

  // 文件输入引用
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 定期将ref中的数据同步到state中，避免频繁更新
  useEffect(() => {
    return () => {
      // 组件卸载时清理定时器
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // 更新UI状态的函数，由定时器调用
  const updateUIState = useCallback(() => {
    if (!isProcessingRef.current) return;

    // 只有当数据变化时才更新状态，减少不必要的渲染
    if (statsRef.current && progressRef.current !== processingProgress) {
      setProcessingProgress(progressRef.current);
    }

    if (statsRef.current && statsRef.current !== processingStats) {
      setProcessingStats({ ...statsRef.current });
    }
  }, [processingProgress, processingStats]);

  // 处理文件选择
  const handleFileSelect = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      if (isProcessingRef.current) return;

      // 标记为处理中
      isProcessingRef.current = true;
      setProcessing(true);

      // 检查网络状态，如果是离线状态，提示用户并继续处理（但不会自动上传）
      if (isOffline && autoUpload) {
        message.warning("当前处于离线状态，文件将保存在本地但不会自动上传");
      }

      const fileArray = Array.from(files);
      const maxSizeBytes = maxSize * 1024 * 1024;

      // 检查文件大小
      const validFiles = fileArray.filter((file) => file.size <= maxSizeBytes);
      const oversizedCount = fileArray.length - validFiles.length;

      // 初始化处理统计信息
      const startTime = Date.now();
      const initialStats: ProcessingStats = {
        total: fileArray.length,
        processed: 0,
        success: 0,
        failed: 0,
        oversized: oversizedCount,
        startTime,
      };

      // 如果没有有效文件，直接完成处理
      if (validFiles.length === 0) {
        const completeStats = {
          ...initialStats,
          processed: fileArray.length,
          endTime: Date.now(),
          totalTime: 0,
        };

        statsRef.current = completeStats;
        progressRef.current = 100;

        // 更新UI
        setProcessingStats(completeStats);
        setProcessingProgress(100);

        // 3秒后重置状态
        setTimeout(() => {
          setProcessing(false);
          setProcessingProgress(0);
          setProcessingStats(null);
          statsRef.current = null;
          progressRef.current = 0;
          isProcessingRef.current = false;
        }, 3000);

        return;
      }

      // 设置初始状态
      statsRef.current = initialStats;
      progressRef.current = 0;

      // 更新UI状态
      setProcessingStats(initialStats);
      setProcessingProgress(0);

      // 设置定时器，定期更新UI状态
      timerRef.current = setInterval(updateUIState, 200);

      const failedFiles: string[] = [];
      const processedFilesInfo: { file: File; id: string; meta: any }[] = [];

      try {
        // 处理每个文件
        for (let i = 0; i < validFiles.length; i++) {
          const file = validFiles[i];

          try {
            // 处理文件并计算MD5
            const meta = await processFileWithWorker(
              file,
              chunkSize,
              useIndexedDB
            );

            // 收集处理成功的文件信息
            processedFilesInfo.push({ file, id: meta.key, meta });

            // 更新统计信息
            if (statsRef.current) {
              statsRef.current.processed++;
              statsRef.current.success++;
            }
          } catch (error) {
            console.error(`处理文件 ${file.name} 失败:`, error);
            failedFiles.push(file.name);

            // 更新统计信息
            if (statsRef.current) {
              statsRef.current.processed++;
              statsRef.current.failed++;
            }
          }

          // 更新进度
          progressRef.current = Math.floor(((i + 1) / validFiles.length) * 100);
        }

        // 处理完成，更新最终统计信息
        const endTime = Date.now();
        if (statsRef.current) {
          statsRef.current.endTime = endTime;
          statsRef.current.totalTime = (endTime - startTime) / 1000;
        }

        progressRef.current = 100;

        // 清除定时器
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        // 最后一次更新UI
        updateUIState();

        // 将处理成功的文件信息批量添加到store
        if (processedFilesInfo.length > 0) {
          addFilesBatch(processedFilesInfo);
        }

        // 如果设置了自动上传且网络正常，则将批量添加的文件添加到上传队列
        if (autoUpload && processedFilesInfo.length > 0 && !isOffline) {
          // 这里文件已经在store中了，只需要调用 uploadFilesInSequence 启动上传
          // uploadFilesInSequence 需要文件ID列表
          const fileIdsToUpload = processedFilesInfo.map((info) => info.id);
          if (fileIdsToUpload.length > 0) {
            // TODO: Call uploadFilesInSequence with fileIdsToUpload. This function is not currently imported or available here.
            // For now, just log, actual upload start needs to be handled by a different mechanism
            console.log(
              "Files processed and ready for auto-upload:",
              fileIdsToUpload
            );
            // You might need to trigger the upload process from FileListPanel or a parent component
            // that has access to uploadFilesInSequence.
            // For demonstration, let's assume a mechanism exists to start upload for these IDs.
          }
        } else if (autoUpload && isOffline && processedFilesInfo.length > 0) {
          message.info(
            `已添加 ${processedFilesInfo.length} 个文件，网络恢复后可手动上传`
          );
        }
      } catch (error) {
        console.error("处理文件时发生错误:", error);

        // 更新错误状态
        const endTime = Date.now();
        if (statsRef.current) {
          statsRef.current.endTime = endTime;
          statsRef.current.totalTime = (endTime - startTime) / 1000;
        }

        // 清除定时器
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        // 最后一次更新UI
        updateUIState();
      }

      // 3秒后重置状态
      setTimeout(() => {
        setProcessing(false);
        setProcessingProgress(0);
        setProcessingStats(null);
        statsRef.current = null;
        progressRef.current = 0;
        isProcessingRef.current = false;
      }, 3000);
    },
    [
      addFile,
      addFilesBatch,
      autoUpload,
      chunkSize,
      fileConcurrency,
      isOffline,
      maxSize,
      updateUIState,
      useIndexedDB,
    ]
  );

  // 处理拖放事件
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);

      const files = e.dataTransfer.files;
      handleFileSelect(files);
    },
    [handleFileSelect]
  );

  // 处理文件选择
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFileSelect(files);
      }
      // 重置文件输入，以便能够再次选择相同的文件
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [handleFileSelect]
  );

  // 格式化处理状态文本
  const getProcessingStatusText = useCallback(() => {
    if (!processingStats) return "正在准备处理文件...";

    const {
      total,
      processed,
      success,
      failed,
      oversized,
      startTime,
      totalTime,
    } = processingStats;

    // 如果处理已完成
    if (totalTime !== undefined) {
      return `处理完成：共 ${total} 个文件，成功 ${success} 个，失败 ${failed} 个，超过大小限制 ${oversized} 个，总耗时 ${totalTime.toFixed(
        1
      )} 秒`;
    }

    // 处理中
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const filesPerSecond =
      processed > 0 ? (processed / elapsedSeconds).toFixed(1) : "0";

    return `正在处理文件 ${processed}/${total}，成功: ${success}，失败: ${failed}，超过大小限制: ${oversized}，速度: ${filesPerSecond} 文件/秒`;
  }, [processingStats]);

  return (
    <div
      className="file-selector"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        marginBottom: "20px",
        opacity: isOffline && autoUpload ? 0.8 : 1,
      }}
    >
      {isOffline && autoUpload && (
        <Alert
          message="网络已断开"
          description="您可以继续添加文件，文件将被保存在本地。当网络恢复后，您可以手动上传它们。"
          type="warning"
          showIcon
          style={{ marginBottom: 16, width: "100%" }}
        />
      )}

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        onChange={handleFileInputChange}
        style={{ display: "none" }}
      />

      {/* 自定义上传按钮 */}
      <Button
        icon={<UploadOutlined />}
        size="large"
        type="primary"
        loading={processing}
        disabled={processing && isOffline && autoUpload}
        onClick={() => fileInputRef.current?.click()}
      >
        选择文件
      </Button>

      {processing && (
        <div style={{ width: "100%", marginTop: "10px" }}>
          <Progress
            percent={processingProgress}
            status={
              processingStats?.totalTime !== undefined ? "success" : "active"
            }
            strokeColor={{
              "0%": "#108ee9",
              "100%": "#87d068",
            }}
          />
          <p style={{ textAlign: "center", marginTop: "5px" }}>
            {getProcessingStatusText()}
          </p>
        </div>
      )}

      <div
        style={{
          width: "100%",
          height: "120px",
          border: `2px dashed ${
            dragging ? "#1890ff" : isOffline ? "#faad14" : "#d9d9d9"
          }`,
          borderRadius: "4px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: "16px",
          transition: "all 0.3s",
          backgroundColor: dragging
            ? "rgba(24, 144, 255, 0.1)"
            : isOffline
            ? "rgba(250, 173, 20, 0.05)"
            : "transparent",
          opacity: processing ? 0.6 : 1,
          pointerEvents: processing ? "none" : "auto",
        }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <p style={{ color: isOffline ? "#faad14" : "#666", margin: 0 }}>
          {processing
            ? "文件处理中，请稍候..."
            : isOffline
            ? "离线模式：您可以添加文件，但无法上传"
            : "或将文件拖放到此处"}
        </p>
      </div>
    </div>
  );
};

export default FileSelector;
