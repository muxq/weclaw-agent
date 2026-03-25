"""Tests for the WeclawAgent command processing."""

from unittest.mock import MagicMock, patch

import pytest

from weclaw.agent import WeclawAgent


@pytest.fixture
def agent():
    return WeclawAgent(config={"crawler": {"max_text_length": 100, "max_links": 3}})


class TestProcessCommand:
    def test_help_command(self, agent):
        reply = agent._process_command("/help")
        assert reply is not None
        assert "/crawl" in reply
        assert "/links" in reply

    def test_unknown_command_returns_none(self, agent):
        assert agent._process_command("/unknown") is None
        assert agent._process_command("hello there") is None

    def test_crawl_command_returns_text(self, agent):
        with patch.object(agent.crawler, "extract_text", return_value="page content"):
            reply = agent._process_command("/crawl https://example.com")
        assert "page content" in reply

    def test_crawl_command_truncates_long_text(self, agent):
        long_text = "x" * 200
        with patch.object(agent.crawler, "extract_text", return_value=long_text):
            reply = agent._process_command("/crawl https://example.com")
        assert "truncated" in reply
        assert len(reply) <= 120  # 100 chars + truncation message overhead

    def test_crawl_command_reports_failure(self, agent):
        with patch.object(agent.crawler, "extract_text", return_value=None):
            reply = agent._process_command("/crawl https://example.com")
        assert "Failed" in reply

    def test_links_command_returns_links(self, agent):
        links = ["https://a.com", "https://b.com"]
        with patch.object(agent.crawler, "extract_links", return_value=links):
            reply = agent._process_command("/links https://example.com")
        assert any(line.strip() == "https://a.com" for line in reply.splitlines())
        assert any(line.strip() == "https://b.com" for line in reply.splitlines())

    def test_links_command_truncates_excess_links(self, agent):
        links = [f"https://example.com/{i}" for i in range(10)]
        with patch.object(agent.crawler, "extract_links", return_value=links):
            reply = agent._process_command("/links https://example.com")
        assert "more" in reply

    def test_links_command_reports_no_links(self, agent):
        with patch.object(agent.crawler, "extract_links", return_value=[]):
            reply = agent._process_command("/links https://example.com")
        assert "No links" in reply

    def test_crawl_command_requires_url(self, agent):
        assert agent._process_command("/crawl") is None

    def test_links_command_requires_url(self, agent):
        assert agent._process_command("/links") is None
