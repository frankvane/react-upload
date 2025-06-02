import { Button, Space, Tooltip } from "antd";
import {
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

import { ByteConvert } from "../utils/fileUtils";
import PercentDisplay from "./PercentDisplay";
import React from "react";
import type { SortOrder } from "antd/es/table/interface";
import { StatusTagWithTooltip } from "./StatusTag";
import type { UploadFile } from "../store/uploadStore";
import { UploadStatus } from "../types/upload";

/**
 * 创建文件列表的表格列配置
 * @param handlers 处理函数对象，包含各种操作的处理函数
 * @returns 表格列配置数组
 */
export const createFileListColumns = (handlers: {
  handleRetry: (id: string) => void;
  handleRemove: (id: string) => void;
  handlePauseFile: (id: string) => void;
  handleResumeFile: (id: string) => void;
}) => {
  const { handleRetry, handleRemove, handlePauseFile, handleResumeFile } =
    handlers;

  return [
    {
      title: "序号",
      key: "index",
      width: "5%",
      render: (_: unknown, __: unknown, index: number) => index + 1,
    },
    {
      title: "文件名",
      dataIndex: "fileName",
      key: "fileName",
      sorter: true,
      sortDirections: ["ascend", "descend"] as SortOrder[],
      render: (fileName: string) => fileName,
      width: "25%",
      ellipsis: true, // 文件名过长时显示省略号
      onCell: () => ({
        style: {
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
      }),
    },
    {
      title: "大小",
      dataIndex: "fileSize",
      key: "fileSize",
      sorter: true,
      sortDirections: ["ascend", "descend"] as SortOrder[],
      render: (fileSize: number) => ByteConvert(fileSize),
      width: "10%",
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      sorter: false,
      render: (status: UploadStatus, record: UploadFile) => (
        <StatusTagWithTooltip
          status={status}
          errorMessage={record.errorMessage}
        />
      ),
      width: "10%",
    },
    {
      title: "进度",
      key: "progress",
      dataIndex: "progress",
      sorter: false,
      sortDirections: ["ascend", "descend"] as SortOrder[],
      render: (_: unknown, record: UploadFile) => {
        if (
          record.status === UploadStatus.DONE ||
          record.status === UploadStatus.INSTANT
        ) {
          return <PercentDisplay percent={100} status="success" />;
        }
        if (
          record.status === UploadStatus.ERROR ||
          record.status === UploadStatus.MERGE_ERROR
        ) {
          return <PercentDisplay percent={record.progress} status="error" />;
        }
        if (record.status === UploadStatus.CALCULATING) {
          return (
            <Tooltip title={`MD5计算进度: ${record.progress}%`}>
              <PercentDisplay percent={record.progress} status="active" />
            </Tooltip>
          );
        }
        if (record.status === UploadStatus.UPLOADING) {
          return <PercentDisplay percent={record.progress} status="active" />;
        }
        // 其他状态
        return <PercentDisplay percent={record.progress} status="normal" />;
      },
      width: "15%",
    },
    {
      title: "修改时间",
      key: "lastModified",
      dataIndex: "lastModified",
      sorter: true,
      sortDirections: ["ascend", "descend"] as SortOrder[],
      render: (lastModified: number) => new Date(lastModified).toLocaleString(),
      width: "15%",
    },
    {
      title: "操作",
      key: "action",
      render: (_: unknown, record: UploadFile) => (
        <Space size="middle">
          {record.status === UploadStatus.UPLOADING && (
            <Button
              type="link"
              icon={<PauseCircleOutlined />}
              onClick={() => handlePauseFile(record.id)}
              size="small"
            >
              暂停
            </Button>
          )}
          {record.status === UploadStatus.PAUSED && (
            <Button
              type="link"
              icon={<PlayCircleOutlined />}
              onClick={() => handleResumeFile(record.id)}
              size="small"
            >
              继续
            </Button>
          )}
          {(record.status === UploadStatus.ERROR ||
            record.status === UploadStatus.MERGE_ERROR) && (
            <Tooltip title={"重试失败文件"}>
              <Button
                type="link"
                icon={<ReloadOutlined />}
                onClick={() => handleRetry(record.id)}
                size="small"
              >
                重试
              </Button>
            </Tooltip>
          )}
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleRemove(record.id)}
            size="small"
          >
            删除
          </Button>
        </Space>
      ),
      width: "20%",
    },
  ];
};

export default createFileListColumns;
