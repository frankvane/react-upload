import { FileOutlined, VideoCameraOutlined } from "@ant-design/icons";

import React from "react";

interface FilePreviewProps {
  file: File;
  size?: number; // 预览图标/缩略图大小
  onClick?: () => void;
}

const FilePreview: React.FC<FilePreviewProps> = ({
  file,
  size = 32,
  onClick,
}) => {
  const url = URL.createObjectURL(file);

  if (file.type.startsWith("image/")) {
    return (
      <img
        src={url}
        alt="预览"
        style={{
          width: size,
          height: size,
          objectFit: "cover",
          borderRadius: 4,
          cursor: onClick ? "pointer" : "default",
        }}
        onClick={onClick}
      />
    );
  }
  if (file.type.startsWith("video/")) {
    return (
      <VideoCameraOutlined
        style={{ fontSize: size, cursor: onClick ? "pointer" : "default" }}
        onClick={onClick}
      />
    );
  }
  if (file.type.startsWith("audio/")) {
    return (
      <FileOutlined
        style={{ fontSize: size, cursor: onClick ? "pointer" : "default" }}
        onClick={onClick}
      />
    );
  }
  // 其他类型
  return (
    <FileOutlined
      style={{ fontSize: size, cursor: onClick ? "pointer" : "default" }}
      onClick={onClick}
    />
  );
};

export default FilePreview;
