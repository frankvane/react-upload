import { Button, Card, Space, Tabs } from "antd";
import {
  ClearOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import React, { useState } from "react";
import {
  clearQueue,
  getQueueStats,
  pauseQueue,
  resumeQueue,
} from "./services/uploadService";

import FileListPanel from "./components/FileListPanel";
import FileSelector from "./components/FileSelector";

interface UploadTaskProps {
  title?: string;
  accept?: string;
  multiple?: boolean;
  maxSize?: number;
  maxCount?: number;
}

const UploadTask: React.FC<UploadTaskProps> = ({
  title = "文件上传",
  accept = "*",
  multiple = true,
  maxSize = 1024, // 默认最大1GB
  maxCount,
}) => {
  const [activeTab, setActiveTab] = useState<string>("uploading");
  const [queuePaused, setQueuePaused] = useState<boolean>(false);

  // 暂停/恢复上传队列
  const toggleQueuePause = () => {
    if (queuePaused) {
      resumeQueue();
      setQueuePaused(false);
    } else {
      pauseQueue();
      setQueuePaused(true);
    }
  };

  // 清空上传队列
  const handleClearQueue = () => {
    clearQueue();
  };

  // 获取队列状态
  const queueStats = getQueueStats();

  // 定义 Tabs 的 items
  const tabItems = [
    {
      key: "uploading",
      label: "上传中",
      children: <FileListPanel showCompleted={false} />,
    },
    {
      key: "all",
      label: "全部文件",
      children: <FileListPanel showCompleted={true} />,
    },
  ];

  return (
    <Card
      title={title}
      extra={
        <Space>
          <Button
            icon={
              queuePaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />
            }
            onClick={toggleQueuePause}
            type={queuePaused ? "primary" : "default"}
          >
            {queuePaused ? "恢复上传" : "暂停上传"}
          </Button>
          <Button
            icon={<ClearOutlined />}
            onClick={handleClearQueue}
            disabled={queueStats.size === 0}
          >
            清空队列
          </Button>
        </Space>
      }
    >
      <FileSelector
        accept={accept}
        multiple={multiple}
        maxSize={maxSize}
        maxCount={maxCount}
      />

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Card>
  );
};

export default UploadTask;
