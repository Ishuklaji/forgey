import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { db } from "@/lib/prisma";
import { CREDIT_COST_PER_GENERATION } from "@/lib/constants";
import type { Message, FileData } from "@/types/workspace";
import { aj } from "@/lib/arcjet";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ─── SSE helper ───────────────────────────────────────────────────────────────

function sseEvent(type: string, payload: unknown): string {
  return `data: ${JSON.stringify({ type, ...(payload as object) })}\n\n`;
}

// ─── Extract short label from a Gemini thought chunk ─────────────────────────
// Gemini thoughts often start with a bold heading like **Verify Config**
// We extract that. If no bold heading, take the first sentence only.

function extractThoughtLabel(text: string): string | null {
  // Try to grab **bold heading** at the start
  const boldMatch = text.match(/\*\*([^*]{4,60})\*\*/);
  if (boldMatch) return boldMatch[1].trim();

  // Fall back to first sentence (up to first . or \n), capped at 60 chars
  const sentence = text.split(/[.\n]/)[0].trim();
  if (sentence.length >= 8 && sentence.length <= 80) return sentence;

  return null;
}

// ─── Structured output schema ─────────────────────────────────────────────────
// Without a schema Gemini often emits raw newlines and unescaped quotes inside
// the code strings, producing invalid JSON. With a schema the output is
// constrained to valid JSON. Dynamic-key maps can't be expressed, so files and
// dependencies come back as arrays and are converted to the FileData shape.

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    assistantMessage: { type: "string" },
    title: { type: "string" },
    files: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, code: { type: "string" } },
        required: ["path", "code"],
      },
    },
    dependencies: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, version: { type: "string" } },
        required: ["name", "version"],
      },
    },
  },
  required: ["assistantMessage", "title", "files", "dependencies"],
};

type ModelFiles =
  | { path: string; code: string }[]
  | Record<string, { code: string }>;
type ModelDeps = { name: string; version: string }[] | Record<string, string>;

function toFilesRecord(files: ModelFiles): Record<string, { code: string }> {
  if (!Array.isArray(files)) return files;
  const out: Record<string, { code: string }> = {};
  for (const f of files) {
    if (!f?.path || typeof f.code !== "string") continue;
    const path = f.path.startsWith("/") ? f.path : `/${f.path}`;
    out[path] = { code: f.code }; // duplicates: last one wins
  }
  return out;
}

function toDepsRecord(deps: ModelDeps | undefined): Record<string, string> {
  if (!deps) return {};
  if (!Array.isArray(deps)) return deps;
  const out: Record<string, string> = {};
  for (const d of deps) if (d?.name) out[d.name] = d.version || "latest";
  return out;
}

// ─── Lenient JSON parsing ─────────────────────────────────────────────────────
// Gemini regularly emits raw newlines/tabs inside JSON string values (the
// generated source code), which JSON.parse rejects with "Bad control
// character in string literal". Escape control characters that appear inside
// strings, and strip accidental ``` fences, before parsing.

function repairJsonControlChars(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        out += ch;
      } else if (ch === "\\") {
        escaped = true;
        out += ch;
      } else if (ch === '"') {
        inString = false;
        out += ch;
      } else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (ch.charCodeAt(0) < 0x20)
        out += "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
      else out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

function parseModelJson<T>(raw: string): T {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(text) as T;
  } catch {
    return JSON.parse(repairJsonControlChars(text)) as T;
  }
}

// ─── npm validation ───────────────────────────────────────────────────────────

async function validateDependencies(
  deps: Record<string, string>,
): Promise<Record<string, string>> {
  const valid: Record<string, string> = {};
  await Promise.all(
    Object.entries(deps).map(async ([pkg, version]) => {
      try {
        const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok) valid[pkg] = version;
      } catch {
        // silently skip hallucinated packages
      }
    }),
  );
  return valid;
}

// ─── History trimming ─────────────────────────────────────────────────────────

function trimHistory(messages: Message[]): Message[] {
  if (messages.length <= 10) return messages;
  return [messages[0], ...messages.slice(-8)];
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert React developer. Your job is to generate complete, working React applications based on user prompts.

RULES:
1. Always respond with a valid JSON object — no markdown fences, no extra text.
2. The JSON must match this exact shape:
{
  "assistantMessage": "<brief explanation of what you built/changed>",
  "title": "<short 2-4 word title for the app, e.g. 'Todo List App'>",
  "files": [
    { "path": "/App.js", "code": "<full file content>" },
    { "path": "/components/SomeComponent.js", "code": "<full file content>" }
  ],
  "dependencies": [
    { "name": "some-package", "version": "latest" }
  ]
}
   List each file path only once.
3. Use React (functional components + hooks). Do NOT use TypeScript in generated files.
4. Use Tailwind CSS for all styling. Do not use CSS modules or inline styles unless absolutely necessary.
5. The entry point must always be /App.js and must export a default component.
6. All imports must reference files you include in "files" or packages in "dependencies".
7. Do not include react, react-dom, or tailwindcss in "dependencies" — they are always available.
8. When modifying existing code, include ALL files (both changed and unchanged) in "files".
9. Keep code clean, readable, and production-quality.
10. If the user attaches an image, use it as a design reference and match the layout/style as closely as possible.
11. Keep apps focused so they generate quickly: prefer 1-5 files and roughly 400 lines of code in total. Do not add features the user did not ask for.`;

// ─── Gemini contents builder ──────────────────────────────────────────────────

function buildContents(messages: Message[], fileData: FileData | null) {
  const trimmed = trimHistory(messages);

  return trimmed.map((msg, idx) => {
    const role = msg.role === "assistant" ? "model" : "user";

    if (msg.role === "user") {
      const parts: object[] = [];

      let text = msg.content;

      if (msg.imageUrl) {
        text = `[The user has attached an image. Use this URL directly in the generated app where relevant (as img src, background-image, etc.): ${msg.imageUrl}]\n\n${text}`;
      }

      const isLast = idx === trimmed.length - 1;
      if (isLast && fileData) {
        text +=
          "\n\nCurrent project files for context:\n" +
          JSON.stringify(fileData, null, 2);
      }

      parts.push({ text });
      return { role, parts };
    }

    return { role, parts: [{ text: msg.content }] };
  });
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { workspaceId, userId, messages, fileData } = body as {
    workspaceId: string | null;
    userId: string;
    messages: Message[];
    fileData: FileData | null;
  };

  if (!messages?.length) {
    return Response.json({ message: "No messages provided" }, { status: 400 });
  }

  // ── Arcjet: rate limit, ai prompt injection, sensitive info ──────────────────
  // detectPromptInjectionMessage requires the actual user text to inspect.

  // const arcjetReq = new Request(request.url, {
  //   method: request.method,
  //   headers: request.headers,
  //   body: JSON.stringify(body),
  // });

  // const lastUserMessage =
  //   [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  // const decision = await aj.protect(arcjetReq, {
  //   requested: 1,
  //   userId: clerkId,
  //   detectPromptInjectionMessage: lastUserMessage,
  // });

  // if (decision.isDenied()) {
  //   return Response.json(
  //     { message: decision.reason?.type ?? "Request blocked" },
  //     { status: 429 },
  //   );
  // }
  // until here is arcjet

  const user = await db.user.findUnique({
    where: { id: userId, clerkId },
    select: { id: true, credits: true },
  });

  if (!user)
    return Response.json({ message: "User not found" }, { status: 404 });
  if (user.credits < CREDIT_COST_PER_GENERATION) {
    return Response.json({ message: "Insufficient credits" }, { status: 402 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const enqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // client went away
        }
      };

      // Heartbeat: Gemini can go 20-30s without emitting anything while it
      // thinks. Idle HTTP/2 streams get reset by proxies/browsers
      // (ERR_HTTP2_PROTOCOL_ERROR), so send an SSE comment every 5s.
      // The client ignores lines that don't start with "data: ".
      const heartbeat = setInterval(() => enqueue(": ping\n\n"), 5000);

      try {
        const contents = buildContents(messages, fileData);

        // Gemini intermittently returns 503 "high demand" / 429 — retry
        // with backoff instead of failing the whole generation.
        const startGemini = () =>
          ai.models.generateContentStream({
            model: "gemini-3.5-flash",
            contents,
            config: {
              systemInstruction: SYSTEM_PROMPT,
              temperature: 0.7,
              responseMimeType: "application/json",
              responseJsonSchema: RESPONSE_SCHEMA,
              thinkingConfig: {
                includeThoughts: true,
              },
            },
          });

        let geminiStream: Awaited<ReturnType<typeof startGemini>> | undefined;
        for (let attempt = 1; ; attempt++) {
          try {
            geminiStream = await startGemini();
            break;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const retryable = /\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED/.test(msg);
            if (!retryable || attempt >= 3) throw err;
            enqueue(
              sseEvent("status", { message: "AI is busy, retrying…" }),
            );
            await new Promise((r) => setTimeout(r, attempt * 2000));
          }
        }

        let accumulated = ""; // final JSON output
        let lastEmitTime = 0; // throttle thought emissions
        let lastProgressTime = 0; // throttle "writing code" progress

        for await (const chunk of geminiStream) {
          const parts = chunk.candidates?.[0]?.content?.parts ?? [];

          for (const part of parts) {
            if (!part.text) continue;

            if (part.thought) {
              // Extract just the short label — not the full wall of text
              const now = Date.now();
              if (now - lastEmitTime > 600) {
                const label = extractThoughtLabel(part.text);
                if (label) {
                  enqueue(sseEvent("status", { message: label }));
                  lastEmitTime = now;
                }
              }
            } else {
              // Actual JSON output
              accumulated += part.text;
              const now = Date.now();
              if (now - lastProgressTime > 3000) {
                const kb = Math.max(1, Math.round(accumulated.length / 1024));
                enqueue(
                  sseEvent("status", { message: `Writing code… (${kb} KB)` }),
                );
                lastProgressTime = now;
              }
            }
          }
        }

        // ── Parse the complete JSON response ──────────────────────────────────

        let parsed: {
          assistantMessage: string;
          title?: string;
          files: ModelFiles;
          dependencies?: ModelDeps;
        };

        try {
          parsed = parseModelJson(accumulated);
        } catch (parseErr) {
          console.error(
            "[gen-ai-code] JSON parse failed:",
            parseErr,
            accumulated.slice(0, 500),
          );
          enqueue(
            sseEvent("error", {
              message: "AI returned invalid JSON. Please try again.",
            }),
          );
          return; // finally closes the stream
        }

        const { assistantMessage, title: aiTitle } = parsed;
        const files = parsed.files ? toFilesRecord(parsed.files) : null;
        const dependencies = toDepsRecord(parsed.dependencies);

        if (!files || Object.keys(files).length === 0) {
          enqueue(
            sseEvent("error", {
              message: "AI response missing files. Please try again.",
            }),
          );
          return; // finally closes the stream
        }

        // ── Validate npm packages ──────────────────────────────────────────────

        enqueue(sseEvent("status", { message: "Validating packages…" }));
        const validatedDeps = await validateDependencies(dependencies ?? {});
        const newFileData: FileData = {
          files,
          dependencies: validatedDeps,
          title: aiTitle,
        };

        // ── Upsert workspace + deduct credit (single transaction) ──────────────

        enqueue(sseEvent("status", { message: "Saving…" }));

        const lastUserMessage = messages[messages.length - 1];
        const updatedMessages: Message[] = [
          ...messages,
          { role: "assistant", content: assistantMessage },
        ];

        const [workspace] = await db.$transaction([
          workspaceId
            ? db.workspace.update({
                where: { id: workspaceId, userId },
                data: {
                  messages: updatedMessages as never,
                  fileData: newFileData as never,
                },
              })
            : db.workspace.create({
                data: {
                  userId,
                  title: aiTitle ?? lastUserMessage.content.slice(0, 80),
                  messages: updatedMessages as never,
                  fileData: newFileData as never,
                },
              }),
          db.user.update({
            where: { id: userId },
            data: { credits: { decrement: CREDIT_COST_PER_GENERATION } },
          }),
        ]);

        const updatedUser = await db.user.findUnique({
          where: { id: userId },
          select: { credits: true },
        });

        // ── Emit final result ──────────────────────────────────────────────────

        enqueue(
          sseEvent("done", {
            workspaceId: workspace.id,
            assistantMessage,
            fileData: newFileData,
            creditsRemaining:
              updatedUser?.credits ?? user.credits - CREDIT_COST_PER_GENERATION,
          }),
        );
      } catch (err) {
        console.error("[gen-ai-code] stream error:", err);
        enqueue(
          sseEvent("error", {
            message: "Something went wrong. Please try again.",
          }),
        );
      } finally {
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export const runtime = "nodejs";
export const maxDuration = 300; // for vercel  - 300s on Fluid
