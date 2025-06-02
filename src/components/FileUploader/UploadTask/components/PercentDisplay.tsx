import {
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
} from "@ant-design/icons";

import React from "react";

/**
 * 简单的百分比显示组件，替代Progress组件以提高性能
 */
const PercentDisplay = React.memo(
  ({
    percent,
    status,
  }: {
    percent: number;
    status: "success" | "error" | "active" | "normal";
  }) => {
    // 保证百分比是整数
    const displayPercent = Math.round(percent);

    // 根据状态设置不同的颜色和图标
    let color = "#1890ff"; // 默认蓝色
    let icon = null;

    switch (status) {
      case "success":
        color = "#52c41a"; // 绿色
        icon = <CheckCircleFilled style={{ marginRight: 5 }} />;
        break;
      case "error":
        color = "#ff4d4f"; // 红色
        icon = <CloseCircleFilled style={{ marginRight: 5 }} />;
        break;
      case "active":
        color = "#1890ff"; // 蓝色
        icon = <LoadingOutlined style={{ marginRight: 5 }} />;
        break;
      default:
        color = "#1890ff"; // 默认蓝色
    }

    return (
      <div style={{ color }}>
        {icon}
        {displayPercent}%
      </div>
    );
  }
);

export default PercentDisplay;
