import { useEffect, useState } from "react";

/**
 * 自定义 Hook，用于动态计算表格高度
 * @param topAreaHeight 表格上方区域高度估计（默认120px）
 * @param bottomAreaHeight 表格下方区域高度估计（默认20px）
 * @param minHeight 最小高度（默认300px）
 * @param maxHeightRatio 最大高度占窗口高度的比例（默认0.7）
 * @returns 计算得到的表格高度
 */
export const useTableHeight = (
  topAreaHeight = 240,
  bottomAreaHeight = 60,
  minHeight = 300,
  maxHeightRatio = 0.5
): number => {
  const [tableHeight, setTableHeight] = useState(400); // 默认高度

  useEffect(() => {
    const calculateHeight = () => {
      // 获取窗口高度
      const windowHeight = window.innerHeight;
      // 可用高度
      const availableHeight = windowHeight - topAreaHeight - bottomAreaHeight;
      // 计算合适的表格高度，最小为minHeight，最大为窗口高度的maxHeightRatio
      const optimalHeight = Math.min(
        Math.max(minHeight, availableHeight),
        windowHeight * maxHeightRatio
      );
      setTableHeight(optimalHeight);
    };

    // 初始计算
    calculateHeight();

    // 窗口大小变化时重新计算
    window.addEventListener("resize", calculateHeight);

    // 清理函数
    return () => {
      window.removeEventListener("resize", calculateHeight);
    };
  }, [topAreaHeight, bottomAreaHeight, minHeight, maxHeightRatio]);

  return tableHeight;
};

export default useTableHeight;
