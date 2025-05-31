/**
 * 内存优化工具
 * 提供内存清理和资源管理功能
 */

// 为Window添加gc属性类型声明
declare global {
  interface Window {
    gc?: () => void;
    performance: Performance & {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    };
  }
}

/**
 * 请求浏览器进行垃圾回收
 * 注意：这只是一个建议，浏览器可能会忽略此请求
 */
export const requestGarbageCollection = (): void => {
  // 尝试释放一些内存
  if (window.gc) {
    try {
      window.gc();
      console.log("手动触发垃圾回收");
    } catch (e) {
      console.warn("手动垃圾回收失败", e);
    }
  }

  // 另一种尝试释放内存的方法
  if (window.performance && window.performance.memory) {
    // 创建一些临时对象然后释放它们，可能会促使浏览器进行垃圾回收
    const tempArray = [];
    for (let i = 0; i < 10000; i++) {
      tempArray.push(new Array(10000).fill(0));
    }
    // 释放引用
    tempArray.length = 0;
  }
};

/**
 * 清理图片URL对象
 * @param urls 要清理的URL对象数组
 */
export const cleanupImageURLs = (urls: string[]): void => {
  urls.forEach((url) => {
    // 只清理blob和object URLs
    if (url && (url.startsWith("blob:") || url.startsWith("data:"))) {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {
        console.warn("清理图片URL失败", e);
      }
    }
  });
};

/**
 * 检查内存使用情况并在内存使用率高时触发优化
 * @param threshold 触发优化的内存使用率阈值（0-1之间的小数）
 */
export const checkAndOptimizeMemory = (threshold: number = 0.7): boolean => {
  if (window.performance && window.performance.memory) {
    const memoryInfo = window.performance.memory;
    const usageRatio = memoryInfo.usedJSHeapSize / memoryInfo.jsHeapSizeLimit;

    if (usageRatio > threshold) {
      console.warn(
        `内存使用率过高 (${(usageRatio * 100).toFixed(2)}%)，尝试优化内存...`
      );
      requestGarbageCollection();
      return true;
    }
  }
  return false;
};

/**
 * 将大文件转换为URL引用，减少内存占用
 * @param file 要转换的文件
 * @returns 文件的URL
 */
export const fileToURL = (file: File): string => {
  return URL.createObjectURL(file);
};

/**
 * 自动内存管理器，定期检查内存使用情况并优化
 */
export class MemoryManager {
  private intervalId: number | null = null;
  private urls: string[] = [];

  /**
   * 启动内存管理器
   * @param checkInterval 检查间隔（毫秒）
   * @param threshold 触发优化的内存使用率阈值（0-1之间的小数）
   */
  start(checkInterval: number = 30000, threshold: number = 0.7): void {
    if (this.intervalId !== null) {
      this.stop();
    }

    this.intervalId = window.setInterval(() => {
      checkAndOptimizeMemory(threshold);
    }, checkInterval);

    console.log(
      `内存管理器已启动，检查间隔: ${checkInterval}ms, 阈值: ${
        threshold * 100
      }%`
    );
  }

  /**
   * 停止内存管理器
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("内存管理器已停止");
    }
  }

  /**
   * 注册一个URL以便在适当的时候清理
   * @param url 要注册的URL
   */
  registerURL(url: string): void {
    this.urls.push(url);
  }

  /**
   * 清理所有注册的URL
   */
  cleanupAllURLs(): void {
    cleanupImageURLs(this.urls);
    this.urls = [];
  }

  /**
   * 强制执行内存优化
   */
  forceOptimize(): void {
    this.cleanupAllURLs();
    requestGarbageCollection();
    console.log("已强制执行内存优化");
  }
}

// 创建一个全局内存管理器实例
export const memoryManager = new MemoryManager();

// 在生产环境中自动启动内存管理器
const isProduction = import.meta.env.PROD;
if (isProduction) {
  memoryManager.start();
}
