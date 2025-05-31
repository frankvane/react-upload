import { Alert, Button, Progress, Upload } from "antd";
import React, { useEffect, useState } from "react";

import { UploadOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import { addFileToQueue } from "../services/uploadService";
import { message } from "antd";
import { processFileWithWorker } from "../utils/fileUtils";
import { useNetworkType } from "../hooks/useNetworkType";
import { useUploadStore } from "../store/uploadStore";

interface FileSelectorProps {
  accept?: string;
  multiple?: boolean;
  maxSize?: number; // 单位：MB
  maxCount?: number;
  autoUpload?: boolean; // 是否自动上传
}

const FileSelector: React.FC<FileSelectorProps> = ({
  accept = "*",
  multiple = true,
  maxSize = 1024, // 默认最大1GB
  maxCount,
  autoUpload = false, // 默认不自动上传
}) => {
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStats, setProcessingStats] = useState<{
    total: number;
    processed: number;
    success: number;
    failed: number;
    oversized: number;
    startTime: number;
    endTime?: number;
    totalTime?: number;
  } | null>(null);

  // 使用网络状态 hook 获取当前网络状态和推荐的上传参数
  const { networkType, chunkSize, fileConcurrency, chunkConcurrency } =
    useNetworkType();

  // 是否处于离线状态
  const isOffline = networkType === "offline";

  const addFile = useUploadStore((state) => state.addFile);

  // 创建一个记录网络状态的引用，便于在日志中查看
  useEffect(() => {
    console.log("当前网络状态:", {
      networkType,
      chunkSize: `${(chunkSize / (1024 * 1024)).toFixed(1)}MB`,
      fileConcurrency,
      chunkConcurrency,
    });
  }, [networkType, chunkSize, fileConcurrency, chunkConcurrency]);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (processing) return;

    // 检查网络状态，如果是离线状态，提示用户并继续处理（但不会自动上传）
    if (isOffline && autoUpload) {
      message.warning("当前处于离线状态，文件将保存在本地但不会自动上传");
    }

    setProcessing(true);
    const fileArray = Array.from(files);
    const maxSizeBytes = maxSize * 1024 * 1024;

    // 检查文件大小
    const validFiles = fileArray.filter((file) => {
      if (file.size > maxSizeBytes) {
        return false; // 超过大小限制
      }
      return true;
    });

    if (validFiles.length === 0) {
      // 不显示 message，只更新统计信息
      setProcessingStats({
        total: fileArray.length,
        processed: fileArray.length,
        success: 0,
        failed: 0,
        oversized: fileArray.length,
        startTime: Date.now(),
        endTime: Date.now(),
        totalTime: 0,
      });
      setProcessingProgress(100);

      // 3秒后自动重置状态
      setTimeout(() => {
        setProcessing(false);
        setProcessingProgress(0);
        setProcessingStats(null);
      }, 3000);

      return;
    }

    // 初始化处理统计信息
    const startTime = Date.now();
    setProcessingStats({
      total: fileArray.length,
      processed: 0,
      success: 0,
      failed: 0,
      oversized: fileArray.length - validFiles.length,
      startTime,
    });
    setProcessingProgress(0);

    const failedFiles: string[] = [];
    const successFileIds: string[] = [];

    try {
      // 使用 Promise.all 并行处理所有文件
      const processPromises = validFiles.map(async (file, index) => {
        try {
          // 先使用 Web Worker 处理文件并计算 MD5
          // 使用当前网络状态推荐的切片大小
          const meta = await processFileWithWorker(file, chunkSize);

          // 使用 MD5 作为文件 ID 添加到 store
          const fileId = addFile(file, meta.key);

          // 将成功的文件ID添加到列表中
          successFileIds.push(fileId);

          // 更新进度和统计信息
          setProcessingStats((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              processed: prev.processed + 1,
              success: prev.success + 1,
            };
          });
          setProcessingProgress(
            Math.floor(((index + 1) / validFiles.length) * 100)
          );

          // 返回文件 ID
          return fileId;
        } catch (error: any) {
          console.error(`处理文件 ${file.name} 失败:`, error);
          failedFiles.push(file.name);

          // 更新统计信息
          setProcessingStats((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              processed: prev.processed + 1,
              failed: prev.failed + 1,
            };
          });
          setProcessingProgress(
            Math.floor(((index + 1) / validFiles.length) * 100)
          );

          return null;
        }
      });

      // 等待所有文件处理完成
      await Promise.all(processPromises);

      // 计算总处理时间
      const endTime = Date.now();
      const totalTime = (endTime - startTime) / 1000;

      // 更新最终统计信息
      setProcessingStats((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          endTime,
          totalTime,
        };
      });

      // 如果设置了自动上传且网络正常，则添加到上传队列
      if (autoUpload && successFileIds.length > 0 && !isOffline) {
        // 创建一个延迟添加的函数，避免同时添加太多文件到队列造成阻塞
        const autoUploadWithDelay = async () => {
          console.log(`开始自动上传 ${successFileIds.length} 个文件`);

          // 将文件添加到上传队列，每个文件间隔100毫秒添加
          for (let i = 0; i < successFileIds.length; i++) {
            const fileId = successFileIds[i];
            addFileToQueue(fileId, fileConcurrency);

            // 每添加一个文件，等待100毫秒，避免过度阻塞
            if (i < successFileIds.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }

          console.log(`已自动上传 ${successFileIds.length} 个文件`);
        };

        // 执行自动上传
        autoUploadWithDelay();
      } else if (autoUpload && isOffline && successFileIds.length > 0) {
        message.info(
          `已添加 ${successFileIds.length} 个文件，网络恢复后可手动上传`
        );
      }

      // 3秒后自动重置状态
      setTimeout(() => {
        setProcessing(false);
        setProcessingProgress(0);
        setProcessingStats(null);
      }, 3000);
    } catch (error) {
      console.error("处理文件时发生错误:", error);

      // 更新统计信息为错误状态
      const endTime = Date.now();
      setProcessingStats((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          endTime,
          totalTime: (endTime - prev.startTime) / 1000,
        };
      });

      // 3秒后自动重置状态
      setTimeout(() => {
        setProcessing(false);
        setProcessingProgress(0);
        setProcessingStats(null);
      }, 3000);
    }
  };

  // 处理拖放事件
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);

    const files = e.dataTransfer.files;
    handleFileSelect(files);
  };

  // 使用 Ant Design 的 Upload 组件
  const uploadProps: UploadProps = {
    beforeUpload: (file) => {
      handleFileSelect([file] as unknown as FileList);
      return false; // 阻止 Upload 组件默认上传行为
    },
    multiple,
    accept,
    showUploadList: false,
    maxCount,
    disabled: processing,
  };

  // 格式化处理状态文本
  const getProcessingStatusText = () => {
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
  };

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

      <Upload {...uploadProps}>
        <Button
          icon={<UploadOutlined />}
          size="large"
          type="primary"
          loading={processing}
          disabled={processing && isOffline && autoUpload}
        >
          选择文件
        </Button>
      </Upload>

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
