import { Switch, Tooltip, Typography } from "antd";

import { DatabaseOutlined } from "@ant-design/icons";
import React from "react";
import { useUploadStore } from "../store/uploadStore";

const { Text } = Typography;

interface IndexedDBSwitchProps {
  // 可以传入自定义标签文本
  label?: string;
  tooltipTitle?: string;
}

/**
 * IndexedDB开关组件，用于控制是否使用IndexedDB存储文件
 */
const IndexedDBSwitch: React.FC<IndexedDBSwitchProps> = ({
  label = "启用离线存储",
  tooltipTitle = "开启后可支持文件的离线存储和断点续传，刷新页面后保留上传状态（默认关闭）",
}) => {
  const { useIndexedDB, setUseIndexedDB } = useUploadStore();

  const handleChange = (checked: boolean) => {
    setUseIndexedDB(checked);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <Tooltip title={tooltipTitle}>
        <Text style={{ display: "flex", alignItems: "center" }}>
          <DatabaseOutlined style={{ marginRight: 4 }} />
          {label}
        </Text>
      </Tooltip>
      <Switch checked={useIndexedDB} onChange={handleChange} size="small" />
    </div>
  );
};

export default IndexedDBSwitch;
