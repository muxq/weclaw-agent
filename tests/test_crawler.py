"""Tests for the Crawler module."""

from unittest.mock import MagicMock, patch

import pytest

from weclaw.crawler import Crawler


@pytest.fixture
def crawler():
    return Crawler(timeout=5)


class TestCrawlerFetch:
    def test_fetch_returns_text_on_success(self, crawler):
        mock_resp = MagicMock()
        mock_resp.text = "<html><body>Hello</body></html>"
        mock_resp.apparent_encoding = "utf-8"
        with patch.object(crawler.session, "get", return_value=mock_resp):
            result = crawler.fetch("http://example.com")
        assert result == "<html><body>Hello</body></html>"

    def test_fetch_returns_none_on_request_exception(self, crawler):
        import requests

        with patch.object(
            crawler.session,
            "get",
            side_effect=requests.RequestException("timeout"),
        ):
            result = crawler.fetch("http://example.com")
        assert result is None


class TestCrawlerExtractText:
    def test_extract_text_strips_scripts_and_styles(self, crawler):
        html = (
            "<html><head><style>body{color:red}</style></head>"
            "<body><script>alert(1)</script><p>Hello world</p></body></html>"
        )
        mock_resp = MagicMock()
        mock_resp.text = html
        mock_resp.apparent_encoding = "utf-8"
        with patch.object(crawler.session, "get", return_value=mock_resp):
            text = crawler.extract_text("http://example.com")
        assert "Hello world" in text
        assert "alert" not in text
        assert "color:red" not in text

    def test_extract_text_returns_none_on_fetch_failure(self, crawler):
        with patch.object(crawler, "fetch", return_value=None):
            result = crawler.extract_text("http://example.com")
        assert result is None


class TestCrawlerExtractLinks:
    def test_extract_links_returns_absolute_links(self, crawler):
        html = (
            '<html><body>'
            '<a href="https://example.com/page1">p1</a>'
            '<a href="/relative">rel</a>'
            '<a href="http://other.com">other</a>'
            "</body></html>"
        )
        with patch.object(crawler, "fetch", return_value=html):
            links = crawler.extract_links("https://example.com")
        assert "https://example.com/page1" in links
        assert "https://example.com/relative" in links
        assert any(link == "http://other.com" for link in links)

    def test_extract_links_deduplicates(self, crawler):
        html = (
            '<html><body>'
            '<a href="https://example.com/page">p</a>'
            '<a href="https://example.com/page">p again</a>'
            "</body></html>"
        )
        with patch.object(crawler, "fetch", return_value=html):
            links = crawler.extract_links("https://example.com")
        assert links.count("https://example.com/page") == 1

    def test_extract_links_returns_empty_on_fetch_failure(self, crawler):
        with patch.object(crawler, "fetch", return_value=None):
            links = crawler.extract_links("http://example.com")
        assert links == []
