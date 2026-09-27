import { mkdir, writeFile } from "node:fs/promises";
import { evaluationCases, fixtureDocuments } from "../tests/fixtures/ai-evaluation.mjs";
import { clientModule } from "../tests/helpers/client-modules.mjs";
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const limit = Number(option("--limit", "3")), repeat = Number(option("--repeat", "1"));
if (!Number.isInteger(limit) || limit < 1 || limit > 120 || !Number.isInteger(repeat) || repeat < 1 || repeat > 3) throw new Error("Use --limit 1..120 and --repeat 1..3.");
const report = { corpusVersion: "academic-v1", cases: evaluationCases.length, heldOut: evaluationCases.filter((c) => c.split === "held-out").length, counts: Object.fromEntries([...new Set(evaluationCases.map((c) => c.category))].map((category) => [category, evaluationCases.filter((c) => c.category === category).length])) };
if (!args.includes("--live")) { console.log(JSON.stringify({ ...report, live: false, notice: "Use --live to send synthetic cases to Gemini. Default: three cases, one repeat. Full release run: --limit 120 --repeat 3. Human grading is required." }, null, 2)); }
else {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required.");
  const { runAssistant } = await import(await clientModule("lib/ai/runner.ts"));
  const { GeminiProvider } = await import(await clientModule("lib/ai/provider.ts"));
  const { buildProposal } = await import(await clientModule("lib/ai/academic-tools.ts"));
  const model = option("--model", process.env.AI_CHAT_MODEL || "gemini-3.8-flash"), results = [];
  const category = option("--category", "");
  const pool = evaluationCases.filter((c) => !category || c.category === category);
  const selected = (args.includes("--smoke") ? pool.filter((c, i) => pool.findIndex(x => x.category === c.category) === i) : pool).slice(0, limit);
  if (!selected.length) throw new Error("No evaluation cases match the selected category.");
  let lastRequest = 0, stopped = false;
  for (const item of selected) {
    for (let attempt = 0; attempt < repeat; attempt++) {
      const context = item.context(), started = Date.now(); let inputTokens = 0, outputTokens = 0;
      const observedTools = [], realProvider = new GeminiProvider(process.env.GEMINI_API_KEY, model, async (...params) => {
        const response = await fetch(...params);
        if (!response.ok) {
          const failure = await response.clone().json().catch(() => ({}));
          // This runner uses fictional fixtures only. Never log request headers or credentials.
          console.log(JSON.stringify({ upstreamStatus: response.status, code: failure.error?.status, diagnostic: String(failure.error?.message ?? "").replaceAll(process.env.GEMINI_API_KEY, "[redacted]").slice(0, 1600) }));
        }
        return response;
      });
      try {
        const response = await runAssistant(context, item.question, [], {
          provider: { async generate(...params) { const r = await realProvider.generate(...params); r.content.parts.forEach((p) => { if (p.functionCall) observedTools.push(p.functionCall.name); }); return r; } },
          search: async (query) => fixtureDocuments(context, query),
          reserve: async () => { const remaining = 13000 - (Date.now() - lastRequest); if (remaining > 0) await new Promise((r) => setTimeout(r, remaining)); lastRequest = Date.now(); },
          usage: async (u) => { inputTokens += u.inputTokens; outputTokens += u.outputTokens; },
        });
        const proposed = response.operations.length ? buildProposal(context, response.operations) : null;
        const text = response.answer.blocks.map((b) => b.text).join(" ");
        const checks = { noUnrequestedOperations: !item.forbidsOperations || !response.operations.length, expectedOperation: !item.expectedOperations || response.operations.some((o) => o.kind === item.expectedOperations), expectedTool: !item.expectedTool || observedTools.includes(item.expectedTool), expectedText: !item.expectedText.length || item.expectedText.some((s) => text.includes(s)), abstention: !item.requiresAbstention || response.answer.blocks.some((b) => b.kind === "unknown") };
        results.push({ id: item.id, split: item.split, attempt, checks, response, preview: proposed?.changes, inputTokens, outputTokens, latencyMs: Date.now() - started, humanReview: { status: "required", supportedClaims: null, criticalFactsCorrect: null, retrievalRecall: null, rubric: item.rubric } });
        console.log(JSON.stringify({ id: item.id, attempt, checks, inputTokens, outputTokens }));
      } catch (error) {
        results.push({ id: item.id, attempt, error: error instanceof Error ? error.message : "Evaluation failed", status: error?.status, tools: observedTools, inputTokens, outputTokens });
        console.log(JSON.stringify({ id: item.id, failed: true, status: error?.status }));
        // Do not burn free quota repeatedly during a provider outage or exhaustion.
        if ([429, 503].includes(error?.status)) { stopped = true; break; }
      }
    }
    if (stopped) break;
  }
  await mkdir(".ai-evals", { recursive: true });
  const path = `.ai-evals/${new Date().toISOString().replaceAll(":", "-")}.json`;
  await writeFile(path, JSON.stringify({ ...report, model, results, releaseApproved: false, notice: "Automated checks do not establish factual support. Complete human review before release." }, null, 2));
  console.log(JSON.stringify({ report: path, completed: results.length, stopped, releaseApproved: false }));
  if (stopped || results.some((r) => r.error || Object.values(r.checks).some((ok) => !ok))) process.exitCode = 1;
}
