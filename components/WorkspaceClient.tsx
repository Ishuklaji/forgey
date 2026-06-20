"use client";
import React, { useCallback, useState } from "react";
import { CodePanel } from "./CodePanel";
import {
  FileData,
  Message,
  StatusStep,
  WorkspaceData,
} from "@/types/workspace";
import { ChatPanel } from "./ChatPanel";

interface WorkspaceClientProps {
  initialPrompt: string | null;
  workspace: WorkspaceData | null;
  userCredits: number;
  userId: string;
  userPlan: string;
}

export function WorkspaceClient({
  initialPrompt,
  workspace,
  userCredits,
  userId,
  userPlan,
}: WorkspaceClientProps) {
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

  const handleGenerate = useCallback(
    async (prompt: string, imageUrl?: string) => {},
    [credits, isGenerating, userId],
  );

  
  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-[#0a0a0a]">
      {/* chat panel - left */}
      <ChatPanel
        isImproving={isImproving}
        messages={messages}
        isGenerating={isGenerating}
        statusLog={statusLog}
        credits={credits}
        initialPrompt={initialPrompt}
        onGenerate={handleGenerate}
        onStop={handleStop}
        userId={userId}
        workspaceId={workspaceId}
        appTitle={fileData?.title ?? workspace?.title ?? null}
      />
      <div className="w-px shrink-0 bg-white/6" />

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
}

export default WorkspaceClient;
