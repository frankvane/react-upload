import { Button, Upload, message } from "antd";
import React, { useState } from "react";

import { UploadOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import { addFileToQueue } from "../services/uploadService";
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
  const addFile = useUploadStore((state) => state.addFile);

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;

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

    // 添加文件到 store 并加入上传队列
    validFiles.forEach((file) => {
      const fileId = addFile(file);
      addFileToQueue(fileId);
    });

    if (validFiles.length > 0) {
      message.success(`已添加 ${validFiles.length} 个文件到上传队列`);
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
      const fileId = addFile(file);
      addFileToQueue(fileId);
      return false; // 阻止 Upload 组件默认上传行为
    },
    multiple,
    accept,
    showUploadList: false,
    maxCount,
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
        <Button icon={<UploadOutlined />} size="large" type="primary">
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
        }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <p style={{ color: "#666", margin: 0 }}>或将文件拖放到此处</p>
      </div>
    </div>
  );
};

export default FileSelector;
