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

  // Extract JSON from markdown fences if present
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

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Failed to parse JSON string:", cleaned);
    throw new Error(`Invalid JSON returned by LLM: ${err.message}`);
  }
}

module.exports = { parseLLMResponse };
