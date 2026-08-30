import asyncio
import logging
from google import genai
from config import get_api_key, SUMMARIZATION_MODEL, LLM_MAX_CONCURRENT

logger = logging.getLogger(__name__)
_semaphore = None


def get_semaphore():
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(LLM_MAX_CONCURRENT)
    return _semaphore


async def _llm_complete(system_msg: str, user_msg: str, model: str) -> str:
    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("No API key configured. Add GEMINI_API_KEY in Settings.")

    client = genai.Client(api_key=api_key)

    full_prompt = f"{system_msg}\n\n{user_msg}"

    response = await asyncio.to_thread(
        client.models.generate_content,
        model=model,
        contents=full_prompt,
    )
    return response.text.strip()


async def summarize_cluster(cluster_text: str, max_tokens: int = 200) -> str:
    system = "You are an expert technical writer."
    user = (
        f"Summarize this cluster of messages from a long AI conversation.\n"
        f"Requirements: capture main topics, key decisions, open questions.\n"
        f"Max length: {max_tokens} tokens. Use bullet points where helpful.\n"
        f"Do NOT quote every message — focus on the \"story\": what was discussed, decided, unresolved.\n\n"
        f"Cluster:\n{cluster_text[:8000]}\n\nSummary:"
    )
    async with get_semaphore():
        return await _llm_complete(system, user, SUMMARIZATION_MODEL)


async def summarize_topics(topics_text: str, max_tokens: int = 400) -> str:
    system = "You are an expert technical writer."
    user = (
        f"Create a comprehensive overview of this entire AI conversation based on the topic summaries below.\n"
        f"Max length: {max_tokens} tokens. Capture the overall arc, main conclusions, key decisions.\n\n"
        f"Topic Summaries:\n{topics_text[:6000]}\n\nOverview:"
    )
    async with get_semaphore():
        return await _llm_complete(system, user, SUMMARIZATION_MODEL)
