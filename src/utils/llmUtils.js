function parseLLMResponse(response) {
  let textStr = '';
  if (response.content && Array.isArray(response.content)) {
    // Some reasoning models return a 'thinking' block followed by a 'text' block.
    // We should extract the actual text block.
    const textBlock = response.content.find(block => block.type === 'text');
    if (textBlock && textBlock.text) {
      textStr = textBlock.text;
    } else {
      // Fallback if there's no explicit 'text' type
      textStr = response.content[0].text || '';
    }
  } else if (response.content && typeof response.content === 'string') {
    textStr = response.content;
  } else if (response.choices && response.choices.length > 0) {
    textStr = response.choices[0].message.content;
  } else if (typeof response === 'string') {
    textStr = response;
  } else {
    console.error('UNEXPECTED LLM RESPONSE:', JSON.stringify(response, null, 2));
    throw new Error('LLM response did not contain expected content or choices array.');
  }

  if (!textStr) {
    throw new Error('LLM returned an empty string.');
  }

  // ── Step 1: Strip chain-of-thought reasoning before JSON ────────────────
  // Reasoning models sometimes output "Let me analyze..." before the JSON.
  // Find the first occurrence of ```json or { and discard everything before it.
  let jsonStart = textStr.indexOf('```json');
  if (jsonStart === -1) jsonStart = textStr.indexOf('```');
  if (jsonStart === -1) jsonStart = textStr.indexOf('{');
  if (jsonStart > 0) {
    const before = textStr.slice(0, jsonStart).trim();
    if (before && !before.startsWith('{') && !before.startsWith('```')) {
      console.warn('[parseLLMResponse] Stripped chain-of-thought reasoning before JSON (' + before.length + ' chars)');
      textStr = textStr.slice(jsonStart);
    }
  }

  // ── Step 2: Extract JSON from markdown fences if present ─────────────────
  let match = textStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let cleaned = match ? match[1].trim() : textStr.trim();

  // If no markdown fences, try to extract from first '{' to last '}'
  if (!match) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
  }

  // ── Step 3: Try direct parse ─────────────────────────────────────────────
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // ── Step 4: Attempt JSON repairs ────────────────────────────────────────
    let repaired = cleaned;
    try {
      // Fix 1: Remove trailing commas before } or ]
      repaired = repaired.replace(/,\s*([}\]])/g, '$1');
      // Fix 2: Remove control characters that break JSON
      repaired = repaired.replace(/[\x00-\x1F]/g, '');
      const result = JSON.parse(repaired);
      console.warn('[parseLLMResponse] JSON repaired (trailing commas/control chars)');
      return result;
    } catch (err2) {
      // ── Step 5: Attempt truncated JSON repair ──────────────────────────────
      // If the LLM hit max_tokens, the JSON is cut off mid-output.
      // Try to close all open brackets/braces and parse what we have.
      try {
        const truncated = repairTruncatedJSON(repaired);
        if (truncated && truncated !== repaired) {
          const result = JSON.parse(truncated);
          console.warn('[parseLLMResponse] JSON repaired (truncated output — closed open brackets)');
          return result;
        }
      } catch (err3) {
        // Both repair attempts failed
      }
      console.error("Failed to parse JSON string (after all repair attempts):", repaired.slice(0, 500));
      throw new Error(`Invalid JSON returned by LLM: ${err.message}`);
    }
  }
}

/**
 * Attempt to repair truncated JSON by closing all open brackets and braces.
 * This handles the case where the LLM hit max_tokens and the JSON was cut off.
 *
 * @param {string} jsonStr - The potentially truncated JSON string
 * @returns {string|null} Repaired JSON string, or null if no repair was needed
 */
function repairTruncatedJSON(jsonStr) {
  // Count open vs close brackets/braces (ignoring those inside strings)
  let inString = false;
  let escape = false;
  const stack = [];

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}') {
      if (stack.length > 0 && stack[stack.length - 1] === '{') stack.pop();
    } else if (ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === '[') stack.pop();
    }
  }

  if (stack.length === 0) return null; // Not truncated, no repair needed

  // If we're in the middle of a string, close it first
  let repaired = jsonStr;
  if (inString) {
    repaired += '"';
  }

  // Remove any trailing incomplete key-value (e.g. "key": "val or "key":)
  // Try to clean up after the last complete value
  // Remove trailing comma if present
  repaired = repaired.replace(/,\s*$/, '');

  // Close all open brackets/braces in reverse order
  while (stack.length > 0) {
    const open = stack.pop();
    repaired += (open === '{') ? '}' : ']';
  }

  return repaired;
}

module.exports = { parseLLMResponse };
