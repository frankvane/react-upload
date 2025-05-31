import { Button, Space } from "antd";

import React from "react";
import { ReloadOutlined } from "@ant-design/icons";

interface FileListToolbarProps {
  hasWaitingFiles: boolean;
  hasUploadingFiles: boolean;
  hasCompletedFiles: boolean;
  failedFilesCount: number;
  onUploadAll: () => void;
  onRetryAllFailed: () => void;
  onClearCompleted: () => void;
}

const FileListToolbar: React.FC<FileListToolbarProps> = ({
  hasWaitingFiles,
  hasUploadingFiles,
  hasCompletedFiles,
  failedFilesCount,
  onUploadAll,
  onRetryAllFailed,
  onClearCompleted,
}) => (
  <Space>
    {hasWaitingFiles && (
      <Button
        type="primary"
        onClick={onUploadAll}
        size="small"
        disabled={hasUploadingFiles}
      >
        全部上传
      </Button>
    )}
    {failedFilesCount > 0 && (
      <Button
        type="link"
        icon={<ReloadOutlined />}
        onClick={onRetryAllFailed}
        size="small"
        disabled={hasUploadingFiles}
      >
        全部重试 ({failedFilesCount})
      </Button>
    )}
    {hasCompletedFiles && (
      <Button
        type="link"
        onClick={onClearCompleted}
        size="small"
        disabled={hasUploadingFiles}
      >
        清除已完成
      </Button>
    )}
  </Space>
);

export default FileListToolbar;
