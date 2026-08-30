from pydantic import BaseModel
from typing import Any, Literal, Optional


class ConversationMessage(BaseModel):
    role: Literal["human", "assistant"]
    text: str
    index: int


class Chunk(BaseModel):
    node_id: str
    conversation_id: str
    level: Literal["CHUNK"] = "CHUNK"
    text: str
    token_count: int
    line_range: tuple[int, int]
    parent_id: Optional[str] = None
    similarity: float = 0.0
    embedding: list[float] = []


class SummaryNode(BaseModel):
    node_id: str
    conversation_id: str
    level: Literal["ROOT", "SECTION", "TOPIC"]
    text: str
    token_count: int
    line_range: tuple[int, int]
    parent_id: Optional[str] = None
    children_ids: list[str] = []
    topic_label: str = ""
    similarity: float = 0.0
    embedding: list[float] = []


class RAPTORTree(BaseModel):
    conversation_id: str
    root_id: str
    nodes: dict[str, Any]
    stats: dict[str, Any] = {}


class IndexRequest(BaseModel):
    conversation_id: str
    messages: list[ConversationMessage]
    options: dict[str, Any] = {}


class IndexResponse(BaseModel):
    conversation_id: str
    status: str
    stats: dict[str, Any] = {}


class QueryRequest(BaseModel):
    conversation_id: str
    query: str
    token_budget: int = 4000
    model: str = "gemini-2.5-flash"


class QueryResponse(BaseModel):
    answer: str
    nodes_used: list[dict] = []
    token_counts: dict[str, Any] = {}
    latency_ms: int = 0
