import { Alert, Button, Space, Tooltip } from "antd";
import {
  ClearOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

import React from "react";

interface UploadActionButtonsProps {
  isOffline: boolean;
  queuePaused: boolean;
  totalPendingCount: number;
  totalFailedCount: number;
  hasCompletedFiles: boolean;
  hasUploadingFiles: boolean;
  uploadingFilesLength: number;
  pendingFilesLength: number;
  pausedFilesLength: number;
  uploadFilesLength: number;
  onUpload: () => void;
  onToggleQueuePause: () => void;
  onRetryAllFailed: () => void;
  onClearQueue: () => void;
  onClearCompleted?: () => void;
}

const UploadActionButtons: React.FC<UploadActionButtonsProps> = ({
  isOffline,
  queuePaused,
  totalPendingCount,
  totalFailedCount,
  hasCompletedFiles,
  hasUploadingFiles,
  uploadingFilesLength,
  pendingFilesLength,
  pausedFilesLength,
  uploadFilesLength,
  onUpload,
  onToggleQueuePause,
  onRetryAllFailed,
  onClearQueue,
  onClearCompleted,
}) => (
  <>
    {isOffline && (
      <Alert
        message="网络已断开"
        description="当前处于离线状态，上传功能暂时不可用。请检查您的网络连接，待网络恢复后可继续上传。"
        type="error"
        showIcon
        icon={<DisconnectOutlined />}
        style={{ marginBottom: 16 }}
      />
    )}
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
        alignItems: "center",
      }}
    >
      <Space wrap>
        {/* 上传文件按钮 */}
        <Tooltip title="上传文件">
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            onClick={onUpload}
            disabled={totalPendingCount === 0 || isOffline || queuePaused}
            style={{ position: "relative", zIndex: 2 }}
          >
            {totalPendingCount > 0 && totalPendingCount}
          </Button>
        </Tooltip>
        {/* 暂停/恢复上传队列按钮 */}
        <Tooltip title={queuePaused ? "恢复上传" : "暂停上传"}>
          <Button
            icon={
              queuePaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />
            }
            onClick={onToggleQueuePause}
            disabled={
              (uploadingFilesLength === 0 &&
                pendingFilesLength === 0 &&
                pausedFilesLength === 0) ||
              isOffline
            }
            type={queuePaused ? "primary" : "default"}
            style={{ position: "relative", zIndex: 2 }}
          />
        </Tooltip>
        {/* 重试失败或已中断文件按钮 */}
        {totalFailedCount > 0 && (
          <Tooltip title="重试失败或已中断文件">
            <Button
              type="primary"
              danger
              icon={<ReloadOutlined />}
              onClick={onRetryAllFailed}
              disabled={isOffline || queuePaused}
              style={{ position: "relative", zIndex: 2 }}
            >
              {totalFailedCount}
            </Button>
          </Tooltip>
        )}
        {/* 清空队列按钮 */}
        <Tooltip title="清空队列">
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={onClearQueue}
            disabled={uploadFilesLength === 0 || uploadingFilesLength > 0}
            style={{ position: "relative", zIndex: 2 }}
          />
        </Tooltip>
        {/* 清除已完成按钮 */}
        {hasCompletedFiles && (
          <Tooltip title="清除已完成">
            <Button
              danger
              icon={<ClearOutlined />}
              onClick={onClearCompleted}
              disabled={hasUploadingFiles}
              style={{ position: "relative", zIndex: 2 }}
            />
          </Tooltip>
        )}
      </Space>
    </div>
  </>
);

export default UploadActionButtons;
