"""
Crawler module for weclaw agent.
Provides web crawling and content extraction utilities.
"""

import logging
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}


class Crawler:
    """Simple HTTP crawler with HTML parsing support."""

    def __init__(self, timeout: int = 10, headers: dict | None = None):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(headers or DEFAULT_HEADERS)

    def fetch(self, url: str) -> str | None:
        """Fetch the raw HTML content of a URL.

        Args:
            url: The URL to fetch.

        Returns:
            The response text, or None on failure.
        """
        try:
            resp = self.session.get(url, timeout=self.timeout)
            resp.raise_for_status()
            resp.encoding = resp.apparent_encoding
            return resp.text
        except requests.RequestException as exc:
            logger.error("Failed to fetch %s: %s", url, exc)
            return None

    def extract_text(self, url: str) -> str | None:
        """Fetch a URL and return its visible text content.

        Args:
            url: The URL to fetch.

        Returns:
            Plain text extracted from the page, or None on failure.
        """
        html = self.fetch(url)
        if html is None:
            return None
        soup = BeautifulSoup(html, "lxml")
        for tag in soup(["script", "style", "head", "noscript"]):
            tag.decompose()
        return soup.get_text(separator="\n", strip=True)

    def extract_links(self, url: str) -> list[str]:
        """Fetch a URL and return all absolute hyperlinks found on the page.

        Args:
            url: The URL to fetch.

        Returns:
            List of absolute URLs found on the page.
        """
        html = self.fetch(url)
        if html is None:
            return []
        soup = BeautifulSoup(html, "lxml")
        base = "{uri.scheme}://{uri.netloc}".format(uri=urlparse(url))
        links = []
        for tag in soup.find_all("a", href=True):
            href = tag["href"].strip()
            if href.startswith(("http://", "https://")):
                links.append(href)
            elif href.startswith("/"):
                links.append(urljoin(base, href))
        return list(dict.fromkeys(links))
