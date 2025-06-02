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
}

const UploadTask: React.FC<UploadTaskProps> = ({
  title = "文件上传",
  accept = "*",
  multiple = true,
  maxSize = 500,
}) => {
  const initializeFromIndexedDB = useUploadStore(
    (state) => state.initializeFromIndexedDB
  );
  const useIndexedDB = useUploadStore((state) => state.useIndexedDB);

  useEffect(() => {
    if (useIndexedDB) {
      initializeFromIndexedDB();
    }
  }, [useIndexedDB, initializeFromIndexedDB]);

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
