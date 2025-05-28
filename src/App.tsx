import React from "react";
import UploadTask from "./components/FileUploader/UploadTask";
import { message } from "antd";

message.config({
  top: 100,
  duration: 2,
  maxCount: 1,
  rtl: false,
  prefixCls: "my-message",
});

const App = () => {
  return <UploadTask />;
};
export default App;
