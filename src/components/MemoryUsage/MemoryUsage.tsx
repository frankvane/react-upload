import { BarChartOutlined, ClearOutlined } from "@ant-design/icons";
import { Button, Card, Progress, Space, Tooltip, Typography } from "antd";
import React, { useEffect, useState } from "react";

import { memoryManager } from "../../utils/memoryOptimizer";

const { Text } = Typography;

interface MemoryInfo {
  usedMemoryMB: string;
  totalMemoryMB: string;
  usagePercentage: number;
  isAvailable: boolean;
}

const MemoryUsage: React.FC = () => {
  const [memoryInfo, setMemoryInfo] = useState<MemoryInfo>({
    usedMemoryMB: "0",
    totalMemoryMB: "0",
    usagePercentage: 0,
    isAvailable: false,
  });

  const [isOptimizing, setIsOptimizing] = useState(false);

  useEffect(() => {
    // 定义获取内存信息的函数
    const updateMemoryInfo = () => {
      if (performance && "memory" in performance) {
        const memoryData = (performance as any).memory;
        if (memoryData) {
          const usedMemoryMB = (
            memoryData.usedJSHeapSize /
            1024 /
            1024
          ).toFixed(2);
          const totalMemoryMB = (
            memoryData.totalJSHeapSize /
            1024 /
            1024
          ).toFixed(2);
          const usagePercentage = Math.min(
            Math.round((Number(usedMemoryMB) / Number(totalMemoryMB)) * 100),
            100
          );

          setMemoryInfo({
            usedMemoryMB,
            totalMemoryMB,
            usagePercentage,
            isAvailable: true,
          });
        }
      }
    };

    // 初始化时获取一次
    updateMemoryInfo();

    // 设置定时器，每秒更新一次
    const intervalId = setInterval(updateMemoryInfo, 1000);

    // 清理函数
    return () => clearInterval(intervalId);
  }, []);

  // 手动优化内存
  const handleOptimizeMemory = () => {
    setIsOptimizing(true);

    // 使用setTimeout确保UI能够更新
    setTimeout(() => {
      try {
        memoryManager.forceOptimize();

        // 延迟更新状态，使用户能看到优化按钮的加载状态
        setTimeout(() => {
          setIsOptimizing(false);
        }, 1000);
      } catch (error) {
        console.error("内存优化失败:", error);
        setIsOptimizing(false);
      }
    }, 100);
  };

  if (!memoryInfo.isAvailable) {
    return (
      <Card
        size="small"
        title={
          <>
            <BarChartOutlined /> 内存使用状态
          </>
        }
        style={{ width: "100%", marginBottom: 16 }}
      >
        <Text type="secondary">此浏览器不支持内存使用监控</Text>
      </Card>
    );
  }

  // 根据内存使用率决定状态颜色
  const getStatusColor = (
    percentage: number
  ): "exception" | "normal" | "success" => {
    if (percentage > 80) return "exception";
    if (percentage > 60) return "normal";
    return "success";
  };

  return (
    <Card
      size="small"
      title={
        <>
          <BarChartOutlined /> 内存使用状态
        </>
      }
      style={{ width: "100%", marginBottom: 16 }}
      extra={
        <Tooltip title="清理内存">
          <Button
            type="text"
            icon={<ClearOutlined />}
            onClick={handleOptimizeMemory}
            loading={isOptimizing}
            disabled={isOptimizing}
          />
        </Tooltip>
      }
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        <Progress
          percent={memoryInfo.usagePercentage}
          status={getStatusColor(memoryInfo.usagePercentage)}
          size="small"
        />
        <Text>
          JS 内存: {memoryInfo.usedMemoryMB} MB / {memoryInfo.totalMemoryMB} MB
        </Text>
      </Space>
    </Card>
  );
};

export default MemoryUsage;
