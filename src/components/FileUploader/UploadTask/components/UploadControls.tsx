import NetworkStatusBadge from "./NetworkStatusBadge";
import React from "react";
import UploadActionButtons from "./UploadActionButtons";
import { useNetworkType } from "../hooks/useNetworkType";
import { useUploadQueueActions } from "../hooks/useUploadQueueActions";

interface UploadControlsProps {
  hasUploadingFiles?: boolean;
  hasCompletedFiles?: boolean;
  onClearCompleted?: () => void;
}

const UploadControls: React.FC<UploadControlsProps> = ({
  hasUploadingFiles = false,
  hasCompletedFiles = false,
  onClearCompleted,
}) => {
  const {
    queuePaused,
    isOffline,
    uploadingFiles,
    pendingFiles,
    pausedFiles,
    uploadFiles,
    handleUpload,
    toggleQueuePause,
    handleRetryAllFailed,
    handleClearQueue,
    totalPendingCount,
    totalFailedCount,
  } = useUploadQueueActions();

  const network = useNetworkType();

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
        alignItems: "center",
      }}
    >
      <UploadActionButtons
        isOffline={isOffline}
        queuePaused={queuePaused}
        totalPendingCount={totalPendingCount}
        totalFailedCount={totalFailedCount}
        hasCompletedFiles={hasCompletedFiles}
        hasUploadingFiles={hasUploadingFiles}
        uploadingFilesLength={uploadingFiles.length}
        pendingFilesLength={pendingFiles.length}
        pausedFilesLength={pausedFiles.length}
        uploadFilesLength={uploadFiles.length}
        onUpload={handleUpload}
        onToggleQueuePause={toggleQueuePause}
        onRetryAllFailed={handleRetryAllFailed}
        onClearQueue={handleClearQueue}
        onClearCompleted={onClearCompleted}
      />
      <NetworkStatusBadge
        networkType={network.networkType}
        chunkSize={network.chunkSize}
        fileConcurrency={network.fileConcurrency}
        chunkConcurrency={network.chunkConcurrency}
        isOffline={isOffline}
      />
    </div>
  );
};

export default UploadControls;
