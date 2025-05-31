import React, { useEffect } from "react";

import { Card } from "antd";
import FileListPanel from "./components/FileListPanel";
import FileSelector from "./components/FileSelector";
import MemoryUsage from "../../MemoryUsage";
import UploadButton from "./components/UploadButton";
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
