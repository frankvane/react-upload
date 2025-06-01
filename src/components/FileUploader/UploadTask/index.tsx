import { Card, Space } from "antd";
import React, { useEffect } from "react";

import FileListPanel from "./components/FileListPanel";
import FileSelector from "./components/FileSelector";
import IndexedDBSwitch from "./components/IndexedDBSwitch";
import MemoryUsage from "../../MemoryUsage";
import UploadButton from "./components/UploadButton";
import { useUploadStore } from "./store/uploadStore";

// import { memoryManager } from "../../../utils/memoryOptimizer";

interface UploadTaskProps {
  title?: string;
  accept?: string;
  multiple?: boolean;
  maxSize?: number;
  maxCount?: number;
  showMemoryUsage?: boolean;
  useIndexedDB?: boolean; // 是否使用IndexedDB存储文件
}

const UploadTask: React.FC<UploadTaskProps> = ({
  title = "文件上传",
  accept = "*",
  multiple = true,
  maxSize = 500,
  maxCount = 10,
  showMemoryUsage = true,
  useIndexedDB = false, // 默认禁用IndexedDB存储
}) => {
  // 注册内存管理器，在内存不足时释放一些资源
  // memoryManager.register("upload", async () => {
  //   // TODO: 实现内存不足时的资源释放
  //   return true;
  // });

  const { setUseIndexedDB, initializeFromIndexedDB } = useUploadStore();

  useEffect(() => {
    // 设置是否使用IndexedDB
    setUseIndexedDB(useIndexedDB);

    // 如果启用了IndexedDB，则从中初始化文件列表
    if (useIndexedDB) {
      initializeFromIndexedDB();
    }
  }, [useIndexedDB, setUseIndexedDB, initializeFromIndexedDB]);

  return (
    <Card
      title={title}
      extra={
        <Space size="middle">
          <IndexedDBSwitch />
          <UploadButton />
        </Space>
      }
    >
      <FileSelector
        accept={accept}
        multiple={multiple}
        maxSize={maxSize}
        maxCount={maxCount}
      />

      <FileListPanel />

      {showMemoryUsage && <MemoryUsage />}
    </Card>
  );
};

export default UploadTask;
