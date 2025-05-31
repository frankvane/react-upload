import { Card, Progress, Space, Typography } from 'antd';
import React, { useEffect, useState } from 'react';

import { BarChartOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface MemoryInfo {
  usedMemoryMB: string;
  totalMemoryMB: string;
  usagePercentage: number;
  isAvailable: boolean;
}

const MemoryUsage: React.FC = () => {
  const [memoryInfo, setMemoryInfo] = useState<MemoryInfo>({
    usedMemoryMB: '0',
    totalMemoryMB: '0',
    usagePercentage: 0,
    isAvailable: false
  });

  useEffect(() => {
    // 定义获取内存信息的函数
    const updateMemoryInfo = () => {
      if (performance && 'memory' in performance) {
        const memoryData = (performance as any).memory;
        if (memoryData) {
          const usedMemoryMB = (memoryData.usedJSHeapSize / 1024 / 1024).toFixed(2);
          const totalMemoryMB = (memoryData.totalJSHeapSize / 1024 / 1024).toFixed(2);
          const usagePercentage = Math.min(
            Math.round((Number(usedMemoryMB) / Number(totalMemoryMB)) * 100),
            100
          );

          setMemoryInfo({
            usedMemoryMB,
            totalMemoryMB,
            usagePercentage,
            isAvailable: true
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

  if (!memoryInfo.isAvailable) {
    return (
      <Card size="small" title={<><BarChartOutlined /> 内存使用状态</>} style={{ width: '100%', marginBottom: 16 }}>
        <Text type="secondary">此浏览器不支持内存使用监控</Text>
      </Card>
    );
  }

  return (
    <Card size="small" title={<><BarChartOutlined /> 内存使用状态</>} style={{ width: '100%', marginBottom: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Progress
          percent={memoryInfo.usagePercentage}
          status={memoryInfo.usagePercentage > 80 ? 'exception' : 'normal'}
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