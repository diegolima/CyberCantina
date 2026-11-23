"""Leaf Pydantic v2 schemas for provider-agnostic LLM tool definitions and calls."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class LlmToolDefinition(BaseModel):
    """Schema describing a single callable function tool exposed to an LLM."""

    name: str = Field(..., min_length=1, max_length=128)
    description: str = Field(..., min_length=1, max_length=2000)
    parameters: dict[str, Any] = Field(default_factory=dict)

    def to_openai_tool(self) -> dict[str, Any]:
        """Serialize into the standard OpenAI/Ollama function-tool envelope."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class LlmToolCall(BaseModel):
    """Normalized tool invocation emitted by an LLM provider."""

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    arguments: dict[str, Any] = Field(default_factory=dict)


class LlmToolCompletionResult(BaseModel):
    """Normalized completion payload returned by `LLMClient.complete_with_tools`."""

    content: str = ""
    thinking: str = ""
    tool_calls: list[LlmToolCall] = Field(default_factory=list)
    done_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
