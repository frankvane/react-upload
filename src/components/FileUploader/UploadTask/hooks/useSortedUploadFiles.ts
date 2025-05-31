import { useMemo, useState } from "react";

import type { SortOrder } from "antd/es/table/interface";
import type { UploadFile } from "../store/uploadStore";

export function useSortedUploadFiles(uploadFiles: UploadFile[]) {
  const [sortState, setSortState] = useState<{
    order: "ascend" | "descend" | undefined;
    columnKey: React.Key | undefined;
  }>({
    order: "ascend",
    columnKey: "lastModified",
  });

  const sortedFiles = useMemo(() => {
    const files = [...uploadFiles];
    if (!sortState.columnKey || sortState.columnKey === "lastModified") {
      return files.sort((a, b) => {
        const result = a.file.lastModified - b.file.lastModified;
        return sortState.order === "ascend" ? result : -result;
      });
    }
    if (sortState.columnKey === "fileName") {
      return files.sort((a, b) => {
        const result = a.file.name.localeCompare(b.file.name);
        return sortState.order === "ascend" ? result : -result;
      });
    }
    if (sortState.columnKey === "fileSize") {
      return files.sort((a, b) => {
        const result = a.file.size - b.file.size;
        return sortState.order === "ascend" ? result : -result;
      });
    }
    if (sortState.columnKey === "status") {
      return files.sort((a, b) => {
        const result = a.status.localeCompare(b.status);
        return sortState.order === "ascend" ? result : -result;
      });
    }
    if (sortState.columnKey === "progress") {
      return files.sort((a, b) => {
        const result = a.progress - b.progress;
        return sortState.order === "ascend" ? result : -result;
      });
    }
    return files;
  }, [uploadFiles, sortState]);

  return { sortedFiles, sortState, setSortState };
}
