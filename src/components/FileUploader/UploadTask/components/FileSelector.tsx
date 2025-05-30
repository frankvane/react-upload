import { Button, Upload, message } from "antd";
import React, { useState } from "react";

import { UploadOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import { addFileToQueue } from "../services/uploadService";
import { processFileWithWorker } from "../utils/fileUtils";
import { useUploadStore } from "../store/uploadStore";

interface FileSelectorProps {
  accept?: string;
  multiple?: boolean;
  maxSize?: number; // 单位：MB
  maxCount?: number;
}

const FileSelector: React.FC<FileSelectorProps> = ({
  accept = "*",
  multiple = true,
  maxSize = 1024, // 默认最大1GB
  maxCount,
}) => {
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const addFile = useUploadStore((state) => state.addFile);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (processing) return;

    setProcessing(true);
    const fileArray = Array.from(files);
    const maxSizeBytes = maxSize * 1024 * 1024;

    // 检查文件大小
    const validFiles = fileArray.filter((file) => {
      if (file.size > maxSizeBytes) {
        message.error(`文件 ${file.name} 超过最大限制 ${maxSize}MB`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) {
      setProcessing(false);
      return;
    }

    message.loading(`正在处理 ${validFiles.length} 个文件...`, 0);

    try {
      // 使用 Promise.all 并行处理所有文件
      const processPromises = validFiles.map(async (file) => {
        try {
          // 添加文件到 store，状态为 QUEUED_FOR_UPLOAD
          const fileId = addFile(file);

          // 使用 Web Worker 处理文件并存储到 IndexedDB
          await processFileWithWorker(file);

          // 返回文件 ID
          return fileId;
        } catch (error: any) {
          console.error(`处理文件 ${file.name} 失败:`, error);
          message.error(
            `文件 ${file.name} 处理失败: ${error.message || "未知错误"}`
          );
          return null;
        }
      });

      // 等待所有文件处理完成
      const fileIds = await Promise.all(processPromises);

      // 过滤掉处理失败的文件
      const successFileIds = fileIds.filter((id) => id !== null) as string[];

      // 将成功处理的文件添加到上传队列
      successFileIds.forEach((fileId) => {
        addFileToQueue(fileId);
      });

      message.destroy();
      if (successFileIds.length > 0) {
        message.success(`已添加 ${successFileIds.length} 个文件到上传队列`);
      }
    } catch (error) {
      console.error("处理文件时发生错误:", error);
      message.error("处理文件时发生错误");
    } finally {
      setProcessing(false);
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

  return (
    <div
      className="file-selector"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        marginBottom: "20px",
      }}
    >
      <Upload {...uploadProps}>
        <Button
          icon={<UploadOutlined />}
          size="large"
          type="primary"
          loading={processing}
        >
          选择文件
        </Button>
      </Upload>

      <div
        style={{
          width: "100%",
          height: "120px",
          border: `2px dashed ${dragging ? "#1890ff" : "#d9d9d9"}`,
          borderRadius: "4px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: "16px",
          transition: "all 0.3s",
          backgroundColor: dragging ? "rgba(24, 144, 255, 0.1)" : "transparent",
          opacity: processing ? 0.6 : 1,
          pointerEvents: processing ? "none" : "auto",
        }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <p style={{ color: "#666", margin: 0 }}>
          {processing ? "正在处理文件..." : "或将文件拖放到此处"}
        </p>
      </div>
    </div>
  );
};

export default FileSelector;
