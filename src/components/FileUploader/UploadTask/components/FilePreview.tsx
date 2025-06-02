import { FileOutlined, VideoCameraOutlined } from "@ant-design/icons";
import React, { useEffect, useState } from "react";

import { useUploadStore } from "../store/uploadStore";

interface FilePreviewProps {
  fileId: string; // 使用fileId代替直接传入file
  size?: number; // 预览图标/缩略图大小
  onClick?: () => void;
}

const FilePreview: React.FC<FilePreviewProps> = ({
  fileId,
  size = 32,
  onClick,
}) => {
  const [url, setUrl] = useState<string>("");
  const getFile = useUploadStore((state) => state.getFile);
  const file = getFile(fileId);

  useEffect(() => {
    if (!file) return;

    // 仅为图片类型创建URL，其他类型使用图标即可
    if (file.type.startsWith("image/")) {
      // 优化：仅为较小的图片创建缩略图，避免大文件导致内存占用过大
      const maxBlobSize = 5 * 1024 * 1024; // 5MB

      if (file.size <= maxBlobSize) {
        const objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);

        // 组件卸载时释放URL
        return () => {
          URL.revokeObjectURL(objectUrl);
        };
      }
    }
  }, [file]);

  // 如果没有找到文件对象，显示默认图标
  if (!file) {
    return (
      <FileOutlined
        style={{ fontSize: size, cursor: onClick ? "pointer" : "default" }}
        onClick={onClick}
      />
    );
  }

  if (file.type.startsWith("image/")) {
    // 对于过大的图片文件，不显示预览，只显示图标
    if (!url && file.size > 5 * 1024 * 1024) {
      return (
        <div
          style={{
            width: size,
            height: size,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#f0f0f0",
            borderRadius: 4,
            cursor: onClick ? "pointer" : "default",
          }}
          onClick={onClick}
        >
          <FileOutlined />
        </div>
      );
    }

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
        loading="lazy" // 使用延迟加载
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
