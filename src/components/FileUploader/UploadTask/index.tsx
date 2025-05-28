import React, { useState } from "react";

import FileListPanel from "./components/FileListPanel";
import FileSelector from "./components/FileSelector";

const UploadTask: React.FC = () => {
  const [progress, setProgress] = useState<number>(100);
  const [costSeconds, setCostSeconds] = useState<number>(0);

  const handleProgress = (
    progress: number,
    current: number,
    total: number,
    cost?: number
  ) => {
    setProgress(progress);
    if (typeof cost === "number") setCostSeconds(cost);
  };

  return (
    <div>
      <h2>文件批量上传任务</h2>
      <FileSelector onProgress={handleProgress} />
      <div style={{ marginTop: 32 }}>
        <FileListPanel progress={progress} costSeconds={costSeconds} />
      </div>
    </div>
  );
};

export default UploadTask;
