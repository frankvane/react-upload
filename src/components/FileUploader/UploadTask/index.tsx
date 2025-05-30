import { Button, Card, Space } from "antd";
import {
  ClearOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import React, { useEffect, useState } from "react";
import {
  clearQueue,
  getQueueStats,
  pauseQueue,
  resumeQueue,
} from "./services/uploadService";

import FileListPanel from "./components/FileListPanel";
import FileSelector from "./components/FileSelector";
import UploadButton from "./components/UploadButton";
import { useUploadStore } from "./store/uploadStore";

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
  const [queuePaused, setQueuePaused] = useState<boolean>(false);
  const initializeFromIndexedDB = useUploadStore(
    (state) => state.initializeFromIndexedDB
  );

  // 在组件挂载时从 IndexedDB 加载文件列表
  useEffect(() => {
    initializeFromIndexedDB();
  }, [initializeFromIndexedDB]);

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

      <div
        style={{ display: "flex", justifyContent: "center", margin: "16px 0" }}
      >
        <UploadButton />
      </div>

      <FileListPanel />
    </Card>
  );
};

export default UploadTask;
