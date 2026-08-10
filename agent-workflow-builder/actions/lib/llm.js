// actions/lib/llm.js
//
// Real call to Groq's OpenAI-compatible chat completions endpoint (free tier
// available at console.groq.com). If GROQ_API_KEY isn't set, falls back to a
// stubbed response with a disclosed artificial delay, per the assignment's
// explicit allowance for that case.

async function callLLM({ prompt, model, temperature }) {
  if (!process.env.GROQ_API_KEY) {
    await new Promise((r) => setTimeout(r, 800)); // disclosed artificial delay
    return {
      text: `[STUBBED LLM RESPONSE — no GROQ_API_KEY configured] Echo: ${prompt.slice(0, 200)}`,
      stubbed: true,
    };
  }

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: model || 'llama-3.1-8b-instant',
      temperature: temperature ?? 0.7,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM call failed (${resp.status}): ${text}`);
  }

  const json = await resp.json();
  return {
    text: json.choices?.[0]?.message?.content ?? '',
    raw: json,
    stubbed: false,
  };
}

module.exports = { callLLM };
