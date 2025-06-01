import "antd/dist/reset.css";

import App from "./App.tsx";
import { createRoot } from "react-dom/client";

// 抑制 React 18 中关于 findDOMNode 的警告
// 这些警告主要来自 Ant Design 内部实现
const originalConsoleError = console.error;
console.error = (...args) => {
  if (
    args[0] &&
    typeof args[0] === "string" &&
    args[0].includes("findDOMNode")
  ) {
    return;
  }
  originalConsoleError(...args);
};

createRoot(document.getElementById("root")!).render(<App />);
