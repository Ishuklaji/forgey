# Forgey

**Forge your dream app from a single prompt.**

Forgey is an agentic AI app builder — describe what you want in plain English and it writes the code, picks the dependencies, and renders a live, working preview right in the browser. No local setup, no build step.

🔗 **Live app:** [forgey.vercel.app](https://forgey.vercel.app)

---

## What it does

Forgey turns a single natural-language prompt into a working React + Tailwind application:

- **Instant generation** — powered by Gemini, prompts are turned into production-ready React + Tailwind code in seconds.
- **Live in-browser preview** — generated apps render instantly via Sandpack, with no install or build step required.
- **Full source access** — every generated file is browsable and editable in a built-in code editor, with the preview updating in real time.
- **Smart package selection** — the AI chooses npm packages for the app, and each one is validated against the npm registry to silently filter out hallucinated dependencies.
- **AI error recovery** — runtime errors in the live preview surface as a banner; one click sends the error back to the AI for an automatic fix.
- **Image-aware prompts** — screenshots or mockups can be attached to a prompt, and the AI generates code that matches the design.
- **Persistent workspaces** — each build lives in a workspace that stores the full chat history and generated files, so you can pick up and keep iterating later.
- **Credits & plans** — usage is metered through a credits system with free and paid tiers, managed via Clerk billing.

## How it works

1. **Describe your app** — type a prompt or pick a suggested idea, optionally attaching a screenshot for extra context.
2. **AI generates code** — the model writes components, chooses dependencies, and structures the project files.
3. **Preview & refine** — the app renders live; keep chatting to iterate, with the AI retaining full conversation context.
4. **Export & deploy** — open the project in CodeSandbox, copy the source, or deploy it to a live URL.

## How to use

1. **Sign in** — open [forgey.vercel.app](https://forgey.vercel.app) and click **Sign in** (new accounts get 10 free credits).
2. **Describe your app** — type what you want in the big box on the home page, for example *"A pomodoro timer with tasks"*, or click one of the suggestions. Press **Enter** or **Generate**.
3. **Wait for it to build** — the chat shows what the AI is doing ("Writing code…"). A generation usually takes about a minute and uses **1 credit**.
4. **Try your app** — it runs live in the **Preview** tab. Switch to the **Code** tab to see and edit every file.
5. **Change it** — type follow-up requests in the chat on the left, like *"make it dark mode"* or *"add a reset button"*. Each change uses 1 credit.
6. **Use a design as a reference** — click the 📎 paperclip in the chat to attach a screenshot or mockup, and the AI will match its look.
7. **Fix errors** — if the preview shows an error banner, click it and the AI will try to fix the code.
8. **Improve with Agent** *(Starter/Pro)* — for bigger changes, click **Improve with Agent** above the preview.
9. **Download your code** — click **Download** to get the whole project as a `.zip`.
10. **Come back later** — open **Projects** in the top bar to reopen or delete any app you've built.

### Tips

- Be specific in your prompt: name the features, colours, and layout you want.
- Your remaining credits are shown in the top bar. Upgrade from the pricing section when you run out.
- If something fails, you'll see an error message and no credit is used — just try again.

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| AI | Google Gemini (`@google/genai`), Cline SDK for agentic code generation |
| Live code execution | Sandpack (`@codesandbox/sandpack-react`) |
| Auth & billing | Clerk (incl. pricing/plans) |
| Database | PostgreSQL via Supabase, Prisma ORM (client engine, `pg` adapter) |
| Security | Arcjet (rate limiting / bot protection) |
| UI | Tailwind CSS v4, shadcn/ui, Radix (Base UI), Framer Motion, Lucide icons |
| Utilities | Zod, JSZip (project export), react-markdown |

## Data model

- **User** — synced from Clerk, tracks `credits` and `plan` (free/paid tier gating).
- **Workspace** — one per generated app; stores the full chat `messages` history and the generated `fileData` as JSON, so builds persist and can be resumed.

## Getting started

```bash
git clone https://github.com/Ishuklaji/forgey.git
cd forgey
npm install
```

Create a `.env` file with:

```bash
DATABASE_URL=              # Postgres connection string (Supabase)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
GOOGLE_GENAI_API_KEY=       # Gemini API key
ARCJET_KEY=
```

Run the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project structure

```
app/          # Next.js App Router pages & API routes
components/   # UI components (shadcn/ui + custom)
lib/          # Data, utils, generated Prisma client
prisma/       # Database schema
actions/      # Server actions
types/        # Shared TypeScript types
```

---

Built by [Ish](https://github.com/Ishuklaji).