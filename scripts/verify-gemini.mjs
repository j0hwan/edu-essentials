// Synthetic-only smoke test. Never reads student records or prints credentials.
const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error("Set GEMINI_API_KEY in the local environment.");
const model = process.env.AI_CHAT_MODEL || "gemini-3.8-flash";
try {
  const listing = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(20000) });
  if (!listing.ok) { console.log(JSON.stringify({ configured: true, model, modelListStatus: listing.status })); process.exitCode = 1; }
  else {
    const data = await listing.json();
    const available = data.models?.some((m) => m.name === `models/${model}`);
    console.log(JSON.stringify({ model, available, alternatives: available ? undefined : data.models?.filter((m) => /flash|pro/.test(m.name) && m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name) }));
    if (!available) process.exitCode = 1;
    else {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, signal: AbortSignal.timeout(45000),
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: 'Synthetic test: a fictional assignment is due 2026-09-24. Return only {"dueDate":"2026-09-24"}.' }] }], generationConfig: { maxOutputTokens: 1024, responseMimeType: "application/json" } }),
      });
      const result = await response.json();
      const text = result.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
      let passed = false; try { passed = JSON.parse(text).dueDate === "2026-09-24"; } catch { /* Report failure without raw provider output. */ }
      console.log(JSON.stringify({ smokeStatus: response.status, passed, providerCode: result.error?.status, usage: result.usageMetadata }));
      if (!passed) process.exitCode = 1;
    }
  }
} catch { console.log(JSON.stringify({ error: "Gemini connectivity test failed; no credentials were logged." })); process.exitCode = 1; }
