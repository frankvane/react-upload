import { Card, Space } from "antd";
import React, { useEffect } from "react";

import FileListPanel from "./components/FileListPanel";
import FileSelector from "./components/FileSelector";
import IndexedDBSwitch from "./components/IndexedDBSwitch";
import { useUploadStore } from "./store/uploadStore";

interface UploadTaskProps {
  title?: string;
  accept?: string;
  multiple?: boolean;
  maxSize?: number;
  useIndexedDB?: boolean; // 是否使用IndexedDB存储文件
}

const UploadTask: React.FC<UploadTaskProps> = ({
  title = "文件上传",
  accept = "*",
  multiple = true,
  maxSize = 500,
  useIndexedDB = false, // 默认禁用IndexedDB存储
}) => {
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
        </Space>
      }
    >
      <FileSelector accept={accept} multiple={multiple} maxSize={maxSize} />

      <FileListPanel />
    </Card>
  );
};

export default UploadTask;
