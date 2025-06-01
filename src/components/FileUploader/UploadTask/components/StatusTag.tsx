import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  StopOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { Tag, Tooltip } from "antd";

import React from "react";
import { UploadStatus } from "../types/upload";

// 根据上传状态获取状态标签
export const getStatusTag = (status: UploadStatus): JSX.Element => {
  switch (status) {
    case UploadStatus.QUEUED:
      return (
        <Tag color="default" icon={<PauseCircleOutlined />}>
          排队中
        </Tag>
      );
    case UploadStatus.QUEUED_FOR_UPLOAD:
      return (
        <Tag color="default" icon={<PauseCircleOutlined />}>
          等待上传
        </Tag>
      );
    case UploadStatus.CALCULATING:
      return (
        <Tag color="processing" icon={<SyncOutlined spin />}>
          计算中
        </Tag>
      );
    case UploadStatus.UPLOADING:
      return (
        <Tag color="processing" icon={<LoadingOutlined />}>
          上传中
        </Tag>
      );
    case UploadStatus.PAUSED:
      return (
        <Tag color="warning" icon={<PauseCircleOutlined />}>
          已暂停
        </Tag>
      );
    case UploadStatus.DONE:
      return (
        <Tag color="success" icon={<CheckCircleOutlined />}>
          已完成
        </Tag>
      );
    case UploadStatus.INSTANT:
      return (
        <Tag color="success" icon={<CheckCircleOutlined />}>
          秒传
        </Tag>
      );
    case UploadStatus.ERROR:
      return (
        <Tag color="error" icon={<CloseCircleOutlined />}>
          失败
        </Tag>
      );
    case UploadStatus.MERGE_ERROR:
      return (
        <Tag color="error" icon={<CloseCircleOutlined />}>
          合并失败
        </Tag>
      );
    case UploadStatus.ABORTED:
      return (
        <Tag color="orange" icon={<StopOutlined />}>
          已中断
        </Tag>
      );
    default:
      return <Tag color="default">未知</Tag>;
  }
};

// 带有错误提示的状态标签组件
export const StatusTagWithTooltip: React.FC<{
  status: UploadStatus;
  errorMessage?: string;
}> = ({ status, errorMessage }) => (
  <Tooltip title={errorMessage}>{getStatusTag(status)}</Tooltip>
);

export default StatusTagWithTooltip;
