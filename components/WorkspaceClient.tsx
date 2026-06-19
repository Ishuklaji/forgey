"use client";
import React, { useCallback, useState } from "react";
import { CodePanel } from "./CodePanel";
import { FileData, Message, StatusStep } from "@/types/workspace";

const WorkspaceClient = () => {
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    workspace?.id ?? null,
  );
  const [messages, setMessages] = useState<Message[]>(
    parseMessages(workspace?.messages),
  );
  const [fileData, setFileData] = useState<FileData | null>(
    parseFileData(workspace?.fileData),
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusLog, setStatusLog] = useState<StatusStep[]>([]);
  const [isImproving, setIsImproving] = useState(false);

  const handleFilePatch = useCallback((patches: FileData) => {
    setFileData(patches);
  }, []);

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-[#0a0a0a]">
      {/* chat panel - left */}
      <div className="w-[320px] shrink-0 border-r border-white/6 bg-[#0d0d0d] flex items-center justify-center ">
        <p className="text-xs text-white/20">Chat Panel</p>
      </div>

      {/* code panel - right   */}
      <CodePanel
        fileData={fileData}
        isGenerating={isGenerating}
        statusLog={statusLog}
        onImprove={handleImprove}
        onFixError={(error) =>
          handleGenerate(
            `There is an error in the preview:\n\n\`\`\`\n${error}\n\`\`\`\n\nPlease fix it.`,
          )
        }
        onFilePatch={handleFilePatch}
        appTitle={fileData?.title ?? workspace?.title ?? null}
        isImproving={isImproving}
        isProUser={userPlan === "pro"}
      />
    </div>
  );
};

export default WorkspaceClient;
