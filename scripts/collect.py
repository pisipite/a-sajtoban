#!/usr/bin/env python3
"""Collect K-Monitor press mentions into static JSON and RSS files."""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Iterable

try:
    import requests
    from googlenewsdecoder import gnewsdecoder
    from selectolax.parser import HTMLParser
except ImportError:  # The collector remains usable without optional context extraction.
    requests = None
    gnewsdecoder = None
    HTMLParser = None


ROOT = Path(__file__).resolve().parents[1]
USER_AGENT = "Mozilla/5.0 (compatible; KMonitorPressWatch/2.0; +https://github.com/pisipite/a-sajtoban)"
REQUEST_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/rss+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.7",
    "Accept-Language": "hu-HU,hu;q=0.9,en;q=0.7",
}
TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")
TERM_RE = re.compile(
    r"\bK[\s\-–—‑]+Monitor(?:ról|ről|nak|nek|ban|ben|ral|rel|t|hoz|hez|höz|ért|os|nál|nél)?\b",
    re.IGNORECASE,
)
LEGACY_HUNGARIAN = str.maketrans({"õ": "ő", "Õ": "Ő", "û": "ű", "Û": "Ű"})
THEME_TERMS = {
    "közpénz", "közbeszerzés", "korrupció", "átláthatóság", "kampány",
    "propaganda", "vagyon", "támogatás", "állami", "önkormányzat",
    "felülvizsgálat", "adatigénylés", "integritás", "választás",
}


def fetch(url: str, attempts: int = 3) -> bytes:
    request = urllib.request.Request(url, headers=REQUEST_HEADERS)
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                return response.read()
        except Exception as error:  # pragma: no cover - network behavior
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"Nem sikerült letölteni: {url}") from last_error


def clean_text(value: str | None) -> str:
    text = html.unescape(TAG_RE.sub(" ", value or "")).translate(LEGACY_HUNGARIAN)
    return SPACE_RE.sub(" ", text).strip()


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.translate(LEGACY_HUNGARIAN))
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def item_id(*parts: str) -> str:
    raw = "|".join(normalized(part) for part in parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def iso_date(value: str) -> str:
    value = clean_text(value)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return value
    for pattern in ("%Y.%m.%d.", "%Y.%m.%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(value, pattern).date().isoformat()
        except ValueError:
            pass
    try:
        return parsedate_to_datetime(value).date().isoformat()
    except (TypeError, ValueError):
        return ""


def reference_sheet_url(spreadsheet_id: str, sheet: str) -> str:
    query = urllib.parse.urlencode({"tqx": "out:csv", "sheet": sheet})
    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/gviz/tq?{query}"


def parse_reference_csv(data: bytes, year: str) -> list[dict]:
    text = data.decode("utf-8-sig")
    reader = csv.DictReader(text.splitlines())
    fields = reader.fieldnames or []
    by_name = {normalized(field): field for field in fields if field}

    def field(*names: str) -> str | None:
        return next((by_name[name] for name in names if name in by_name), None)

    date_field = field("datum")
    title_field = field("cim")
    source_field = field("forras")
    url_field = field("link", "url")
    topic_field = field("tema")
    type_field = field("tipus")
    if not all((date_field, title_field, source_field, url_field)):
        raise ValueError(f"A(z) {year} munkalap szükséges oszlopai nem találhatók: {fields}")

    output: list[dict] = []
    for row in reader:
        date = iso_date(row.get(date_field, ""))
        title = clean_text(row.get(title_field, ""))
        source = clean_text(row.get(source_field, ""))
        url = clean_text(row.get(url_field, ""))
        if not title or not url:
            continue
        output.append({
            "id": item_id(url, title, source),
            "kind": "curated",
            "date": date,
            "title": title,
            "source": source,
            "url": url,
            "topic": clean_text(row.get(topic_field, "")) if topic_field else "",
            "article_type": clean_text(row.get(type_field, "")) if type_field else "",
            "score": 100,
            "reasons": ["Korábban relevánsnak válogatva"],
            "reference_year": year,
        })
    return output


def load_reference_sheets(config: dict, fallback: list[dict]) -> tuple[list[dict], list[str], list[str]]:
    spreadsheet_id = config["reference_spreadsheet_id"]
    first_year = int(config.get("reference_first_year", 2014))
    last_year = int(config.get("reference_last_year", datetime.now().year))
    years = [str(year) for year in range(last_year, first_year - 1, -1)]
    fallback_by_year: dict[str, list[dict]] = {}
    for item in fallback:
        year = str(item.get("reference_year") or item.get("date", "")[:4])
        fallback_by_year.setdefault(year, []).append(item)

    collected: list[dict] = []
    errors: list[str] = []

    def load_year(year: str) -> tuple[str, list[dict]]:
        url = reference_sheet_url(spreadsheet_id, year)
        return year, parse_reference_csv(fetch(url), year)

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(load_year, year): year for year in years}
        results: dict[str, list[dict]] = {}
        for future in as_completed(futures):
            year = futures[future]
            try:
                _, rows = future.result()
                results[year] = rows
            except Exception as error:
                errors.append(f"{year}: {error}")
                results[year] = fallback_by_year.get(year, [])

    for year in years:
        collected.extend(results.get(year, []))
    unique = {item["id"]: item for item in collected}
    return list(unique.values()), years, errors


def google_news_url(query: str, locale: dict) -> str:
    params = {"q": query, **locale}
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode(params)


def rss_items(data: bytes) -> Iterable[dict]:
    root = ET.fromstring(data)
    for node in root.findall(".//item"):
        source_node = node.find("source")
        yield {
            "title": clean_text(node.findtext("title")),
            "url": clean_text(node.findtext("link")),
            "description": clean_text(node.findtext("description")),
            "date": iso_date(node.findtext("pubDate") or ""),
            "source": clean_text(source_node.text if source_node is not None else "").strip(" |–—-"),
            "source_url": (source_node.attrib.get("url", "") if source_node is not None else ""),
        }


def strip_source_suffix(title: str, source: str) -> str:
    if not source:
        return title
    suffix = re.compile(rf"\s+-\s+(?:\|\s*)?{re.escape(source)}\s*$", re.IGNORECASE)
    return suffix.sub("", title).strip()


def score_candidate(item: dict, known_sources: set[str], known_topics: Counter | dict) -> tuple[int, list[str], str]:
    title = normalized(item["title"])
    description = normalized(item["description"])
    source = normalized(item["source"])
    score = 28
    reasons = ["Névkeresésből érkezett"]

    if "k monitor" in title:
        score += 42
        reasons.append("A név szerepel a címben")
    elif "k monitor" in description:
        score += 20
        reasons.append("A név szerepel a kivonatban")

    if source in known_sources:
        score += 9
        reasons.append("Korábban releváns forrás")

    matching_terms = sorted(term for term in THEME_TERMS if normalized(term) in f"{title} {description}")
    if matching_terms:
        score += min(15, 5 * len(matching_terms))
        reasons.append("Témaegyezés: " + ", ".join(matching_terms[:3]))

    best_topic = ""
    text = f"{title} {description}"
    topic_counts = known_topics if isinstance(known_topics, Counter) else Counter(known_topics)
    for topic, _count in topic_counts.most_common():
        topic_norm = normalized(topic)
        if len(topic_norm) >= 5 and topic_norm in text:
            best_topic = topic
            score += 6
            reasons.append("Korábbi témával egyezik")
            break

    return min(score, 100), reasons, best_topic


def host(value: str) -> str:
    return urllib.parse.urlparse(value).netloc.lower().removeprefix("www.")


def sentence_context(text: str, max_chars: int = 360) -> str:
    text = clean_text(text)
    if not TERM_RE.search(text):
        return ""
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
    index = next((i for i, sentence in enumerate(sentences) if TERM_RE.search(sentence)), None)
    if index is None:
        match = TERM_RE.search(text)
        start = max(0, match.start() - max_chars // 3)
        return ("…" if start else "") + text[start:start + max_chars].strip() + ("…" if start + max_chars < len(text) else "")
    chosen = sentences[index]
    if len(chosen) < 180 and index + 1 < len(sentences):
        chosen += " " + sentences[index + 1]
    if len(chosen) < 180 and index > 0:
        chosen = sentences[index - 1] + " " + chosen
    if len(chosen) > max_chars:
        match = TERM_RE.search(chosen)
        start = max(0, match.start() - max_chars // 3)
        chosen = ("…" if start else "") + chosen[start:start + max_chars].strip() + ("…" if start + max_chars < len(chosen) else "")
    return chosen


def extract_context_from_html(page_html: str, title: str) -> tuple[str, str]:
    if HTMLParser is None:
        return "", "unavailable"
    tree = HTMLParser(page_html)
    seen: set[str] = set()
    for selector in ("article p", "[itemprop='articleBody'] p", "main p", "p"):
        for node in tree.css(selector):
            paragraph = clean_text(node.text(separator=" ", strip=True))
            key = normalized(paragraph)
            if key in seen or len(paragraph) < 35:
                continue
            seen.add(key)
            context = sentence_context(paragraph)
            if context:
                return context, "article"

    for selector in ("meta[name='description']", "meta[property='og:description']", "meta[name='twitter:description']"):
        node = tree.css_first(selector)
        description = clean_text(node.attributes.get("content", "")) if node else ""
        context = sentence_context(description)
        if context:
            return context, "meta"

    body_text = clean_text(tree.body.text(separator=" ", strip=True)) if tree.body else ""
    context = sentence_context(body_text)
    if context:
        return context, "article"
    if TERM_RE.search(title):
        return f'A K-Monitor a cikk címében szerepel: „{title}”.', "title"
    return "", "unavailable"


def fetch_article_context(item: dict) -> dict:
    if item.get("context"):
        return item
    fallback = (
        f'A K-Monitor a cikk címében szerepel: „{item["title"]}”.'
        if TERM_RE.search(item["title"])
        else "A kereső K-Monitor-említést jelez, de a cikk szövege nem volt automatikusan hozzáférhető."
    )
    if requests is None or gnewsdecoder is None or HTMLParser is None:
        return {**item, "context": fallback, "context_source": "unavailable"}
    try:
        decoded = gnewsdecoder(item["google_news_url"])
        article_url = decoded.get("decoded_url") if isinstance(decoded, dict) and decoded.get("status") else ""
        if not article_url:
            raise RuntimeError("A Google News-link nem volt feloldható")
        response = requests.get(article_url, headers={"User-Agent": USER_AGENT}, timeout=25, allow_redirects=True)
        response.raise_for_status()
        if "html" not in response.headers.get("content-type", "").lower():
            raise RuntimeError("A forrás nem HTML-oldal")
        context, source = extract_context_from_html(response.text, item["title"])
        return {
            **item,
            "url": response.url,
            "context": context or fallback,
            "context_source": source if context else "unavailable",
            "context_checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
    except Exception:
        return {
            **item,
            "context": fallback,
            "context_source": "unavailable",
            "context_checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }


def load_previous(path: Path) -> tuple[dict[str, dict], list[dict], bool]:
    if not path.exists():
        return {}, [], False
    try:
        items = json.loads(path.read_text(encoding="utf-8"))
        candidates = {item["id"]: item for item in items if item.get("kind") == "candidate"}
        curated = [item for item in items if item.get("kind") == "curated"]
        return candidates, curated, True
    except (OSError, json.JSONDecodeError, TypeError):
        return {}, [], False


def is_within_lookback(value: str, days: int, now: datetime | None = None) -> bool:
    """Return whether a YYYY-MM-DD value belongs to the rolling review window."""
    try:
        article_date = datetime.fromisoformat(value).date()
    except (TypeError, ValueError):
        return False
    today = (now or datetime.now(timezone.utc)).date()
    return article_date >= today - timedelta(days=days)


def build_feed(items: list[dict], site_url: str, updated_at: str) -> bytes:
    rss = ET.Element("rss", version="2.0")
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = "K-Monitor sajtófigyelő"
    ET.SubElement(channel, "link").text = site_url
    ET.SubElement(channel, "description").text = "Új internetes sajtómegjelenések a K-Monitorról"
    ET.SubElement(channel, "language").text = "hu"
    ET.SubElement(channel, "lastBuildDate").text = updated_at
    for article in sorted(items, key=lambda row: row["date"], reverse=True)[:50]:
        node = ET.SubElement(channel, "item")
        ET.SubElement(node, "title").text = article["title"]
        ET.SubElement(node, "link").text = article["url"]
        ET.SubElement(node, "guid", isPermaLink="false").text = article["id"]
        ET.SubElement(node, "description").text = f'{article["source"]} · relevancia: {article["score"]}/100 · {article.get("context", "")}'
        try:
            dt = datetime.fromisoformat(article["date"]).replace(tzinfo=timezone.utc)
            ET.SubElement(node, "pubDate").text = dt.strftime("%a, %d %b %Y %H:%M:%S GMT")
        except ValueError:
            pass
    ET.indent(rss)
    return ET.tostring(rss, encoding="utf-8", xml_declaration=True)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=ROOT / "data/config.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/items.json")
    parser.add_argument("--meta-output", type=Path, default=ROOT / "data/meta.json")
    parser.add_argument("--feed-output", type=Path, default=ROOT / "feed.xml")
    parser.add_argument("--new-output", type=Path, default=ROOT / "data/new-items.md")
    parser.add_argument("--site-url", default=os.getenv("SITE_URL", "https://pisipite.github.io/a-sajtoban/"))
    parser.add_argument("--skip-context", action="store_true", help="Cikkoldalak letöltésének kihagyása")
    args = parser.parse_args()

    config = json.loads(args.config.read_text(encoding="utf-8"))
    previous, _previous_curated, had_previous = load_previous(args.output)
    curated, _reference_years, reference_errors = load_reference_sheets(config, [])
    known_sources = {normalized(item["source"]) for item in curated if item["source"]}
    known_topics = Counter(item["topic"] for item in curated if item["topic"])
    curated_titles = {normalized(item["title"]) for item in curated}
    excluded = set(config.get("excluded_domains", []))

    lookback_days = int(config.get("lookback_days", 30))

    # A Google News találati sorrendje futásonként változhat. Az előző
    # futás friss jelöltjeit ezért megtartjuk, de a gördülő időablaknál
    # régebbi cikkeket nem tároljuk ebben a statikus adatfájlban.
    candidates: dict[str, dict] = {
        identifier: item for identifier, item in previous.items()
        if is_within_lookback(item.get("date", ""), lookback_days)
    }
    collection_errors: list[str] = []
    successful_query_count = 0
    for query in config["queries"]:
        url = google_news_url(query, config["locale"])
        try:
            feed_rows = list(rss_items(fetch(url)))
            successful_query_count += 1
            for raw in feed_rows:
                title = strip_source_suffix(raw["title"], raw["source"])
                if (not title or not raw["url"] or host(raw["source_url"]) in excluded
                        or not is_within_lookback(raw["date"], lookback_days)):
                    continue
                if normalized(title) in curated_titles:
                    continue
                score, reasons, topic = score_candidate({**raw, "title": title}, known_sources, known_topics)
                identifier = item_id(title, raw["source"], raw["date"])
                old = previous.get(identifier, {})
                candidate = {
                    "id": identifier,
                    "kind": "candidate",
                    "date": raw["date"],
                    "title": title,
                    "source": raw["source"],
                    "url": old.get("url") or raw["url"],
                    "google_news_url": raw["url"],
                    "topic": topic,
                    "article_type": "",
                    "score": score,
                    "reasons": reasons,
                    "first_seen": old.get("first_seen") or datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "context": old.get("context", "") if len(old.get("context", "")) <= 360 else "",
                    "context_source": old.get("context_source", ""),
                    "context_checked_at": old.get("context_checked_at", ""),
                }
                existing = candidates.get(identifier)
                if existing is None or candidate["score"] > existing["score"]:
                    candidates[identifier] = candidate
        except Exception as error:
            collection_errors.append(f"{query}: {error}")

    if not args.skip_context:
        pending = [item for item in candidates.values() if not item.get("context")]
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = {executor.submit(fetch_article_context, item): item["id"] for item in pending}
            for future in as_completed(futures):
                identifier = futures[future]
                try:
                    candidates[identifier] = future.result()
                except Exception:
                    candidates[identifier] = fetch_article_context(candidates[identifier])

    candidate_list = sorted(candidates.values(), key=lambda row: (row["date"], row["score"]), reverse=True)
    new_items = [item for item in candidate_list if item["id"] not in previous] if had_previous else []
    relevant_new = [item for item in new_items if item["score"] >= config.get("high_confidence_score", 60)]
    updated = datetime.now(timezone.utc).isoformat(timespec="seconds")

    write_json(args.output, candidate_list)
    write_json(args.meta_output, {
        "updated_at": updated,
        "candidate_count": len(candidate_list),
        "lookback_days": lookback_days,
        "new_count": len(new_items),
        "high_confidence_new_count": len(relevant_new),
        "successful_query_count": successful_query_count,
        "configured_query_count": len(config["queries"]),
        "collection_errors": reference_errors + collection_errors,
    })
    args.feed_output.write_bytes(build_feed(candidate_list, args.site_url, updated))
    digest = ["## Új, erős K-Monitor sajtótalálatok", ""]
    for item in relevant_new[:20]:
        digest.append(f'- [{item["title"]}]({item["url"]}) — {item["source"]} ({item["score"]}/100)')
        digest.append(f'  - {item.get("context", "Nincs automatikus szövegkörnyezet.")}')
    args.new_output.write_text("\n".join(digest) + "\n", encoding="utf-8")

    github_output = os.getenv("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as output:
            output.write(f"new_count={len(new_items)}\n")
            output.write(f"high_confidence_new_count={len(relevant_new)}\n")
            output.write(f"successful_query_count={successful_query_count}\n")
    print(f"{len(candidate_list)} jelölt a {lookback_days} napos időablakban, {len(relevant_new)} új erős egyezés")
    if reference_errors or collection_errors:
        print("Figyelmeztetések: " + " | ".join(reference_errors + collection_errors), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
