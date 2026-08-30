import asyncio
import time
import logging
from google import genai
from config import get_api_key, QA_MODEL

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = "You are an expert assistant with access to this user's conversation history."

QA_TEMPLATE = """Answer the question below using only the provided context.
- Be clear and concise
- Cite conversation sections when relevant ("Earlier, you mentioned…", "In the section about X…")
- Focus on the evolution of ideas and decisions over time
- If context is insufficient, say so and explain what's missing

Context:
{context_text}

Question: {query}

Answer:"""


async def answer_question(query: str, context_text: str, model: str = None) -> tuple[str, int]:
    """Returns (answer_text, latency_ms)."""
    model = model or QA_MODEL
    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("No API key configured. Add GEMINI_API_KEY in Settings.")

    client = genai.Client(api_key=api_key)

    user_msg = QA_TEMPLATE.format(context_text=context_text, query=query)
    full_prompt = f"{SYSTEM_PROMPT}\n\n{user_msg}"

    start = time.time()
    response = await asyncio.to_thread(
        client.models.generate_content,
        model=model,
        contents=full_prompt,
    )
    latency_ms = int((time.time() - start) * 1000)

    return response.text.strip(), latency_ms
