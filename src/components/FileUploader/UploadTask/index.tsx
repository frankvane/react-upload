import React, { useEffect } from "react";

import { Card } from "antd";
import FileListPanel from "./components/FileListPanel";
import FileSelector from "./components/FileSelector";
import MemoryUsage from "../../MemoryUsage";
import UploadButton from "./components/UploadButton";
import { memoryManager } from "../../../utils/memoryOptimizer";
import { useUploadStore } from "./store/uploadStore";

interface UploadTaskProps {
  title?: string;
  accept?: string;
  multiple?: boolean;
  maxSize?: number;
  maxCount?: number;
  showMemoryUsage?: boolean;
}

const UploadTask: React.FC<UploadTaskProps> = ({
  title = "文件上传",
  accept = "*",
  multiple = true,
  maxSize = 1024, // 默认最大1GB
  maxCount,
  showMemoryUsage = true,
}) => {
  const initializeFromIndexedDB = useUploadStore(
    (state) => state.initializeFromIndexedDB
  );

  // 在组件挂载时从 IndexedDB 加载文件列表
  useEffect(() => {
    initializeFromIndexedDB();
  }, [initializeFromIndexedDB]);

  // 在组件挂载时启动内存管理器，并在卸载时停止
  useEffect(() => {
    // 启动内存管理器，设置为每15秒检查一次，内存使用率超过70%时触发优化
    memoryManager.start(15000, 0.7);

    // 在组件卸载时停止内存管理器
    return () => {
      memoryManager.stop();
      // 在组件卸载时清理所有URL资源
      memoryManager.cleanupAllURLs();
    };
  }, []);

  return (
    <Card title={title}>
      {showMemoryUsage && <MemoryUsage />}

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
