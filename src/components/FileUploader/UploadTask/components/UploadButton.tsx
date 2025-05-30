import { Button, message } from "antd";

import { CloudUploadOutlined } from "@ant-design/icons";
import React from "react";
import { UploadStatus } from "../types/upload";
import { addFileToQueue } from "../services/uploadService";
import { useUploadStore } from "../store/uploadStore";

const UploadButton: React.FC = () => {
  const uploadFiles = useUploadStore((state) => state.uploadFiles);

  // 获取所有处于 QUEUED_FOR_UPLOAD 状态的文件
  const pendingFiles = uploadFiles.filter(
    (file) => file.status === UploadStatus.QUEUED_FOR_UPLOAD
  );

  const handleUpload = () => {
    if (pendingFiles.length === 0) {
      message.warning("没有待上传的文件");
      return;
    }

    // 将所有待上传文件添加到上传队列
    pendingFiles.forEach((file) => {
      addFileToQueue(file.id);
    });

    message.success(`开始上传 ${pendingFiles.length} 个文件`);
  };

  return (
    <Button
      type="primary"
      icon={<CloudUploadOutlined />}
      onClick={handleUpload}
      disabled={pendingFiles.length === 0}
      style={{ marginBottom: 16 }}
    >
      上传文件 {pendingFiles.length > 0 ? `(${pendingFiles.length})` : ""}
    </Button>
  );
};

export default UploadButton;
