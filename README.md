# Data Extraction API

## What this project does (short)

This API crawls company websites, extracts useful signals (phone numbers, social links, addresses), analyzes scraping coverage, merges scraped data with a CSV company source, and indexes the final company profiles into Elasticsearch for matching.

## Quick start

1. Install dependencies:

```bash
npm i
```

2. Start Elasticsearch and Kibana:

```bash
docker compose up -d
```

3. Start the API:

```bash
npm run start
```

4. Open Swagger UI:
- `http://localhost:3000/`
- `http://localhost:3000/docs`

## API usage flow (step by step)

1. Start scraping from Swagger:
- Call `POST /scraping/start`.

2. Monitor scraping:
- Call `GET /scraping/status` until state is `completed`.

3. Check scraped results analysis:
- Use the analysis route from Swagger to inspect coverage/fill-rate from `data/scraped-results.json`.

4. Merge and index data in Elasticsearch:
- Call `POST /merge-and-index`.
- This merges local files (`sample-websites-company-names.csv` + `data/scraped-results.json`) and indexes the result in Elasticsearch.

5. Match companies:
- Call `POST /api/match-company` with one or more optional datapoints (`name`, `website`, `phone_number`, `facebook_profile`).

## Test script

There is a root script, `test-api.ts`, that tests the API flow with the test input file.

Run it with:

```bash
ts-node test-api.ts
```

## Technical details

### 1. Parallel scraping with max concurrency

The scraper uses a promise pool with a hard limit of 100 concurrent website tasks.

How it works:
1. A task is created for each website.
2. Each task calls the scraping pipeline for one domain.
3. Active tasks are tracked in memory.
4. When the active count reaches 100, the flow waits for the first completed task.
5. As soon as one finishes, a new task starts.

This keeps throughput high while preventing too many open requests/sockets at once.

### 2. How website data is extracted

For each website, the API tries both `https://` and `http://`, with browser-like headers and redirect support.

After HTML is fetched, extraction is done in layers:
1. JSON-LD parsing:
- Reads structured data blocks (`application/ld+json`) for `telephone` and address objects.
2. Direct link extraction:
- Reads `tel:` links for phone candidates.
- Reads social URLs from anchor tags (Facebook, Instagram, LinkedIn, X/Twitter, YouTube, TikTok, others).
3. Text fallback:
- Scans cleaned page text for phone numbers and addresses when structured signals are missing.

Normalization/deduplication is applied before persistence:
1. Phones are validated/normalized.
2. Website domains are normalized.
3. Social lists and addresses are deduplicated.

Results are written incrementally in JSON batches so memory usage stays stable on large crawls.

### 3. How data is indexed and queried in Elasticsearch

The merge-and-index flow combines:
1. CSV company source file.
2. Scraped JSON output file.

Then it normalizes and builds unified company documents (`names[]`, `website`, `phone_numbers[]`, `facebook_profile`) and bulk indexes them.

`POST /api/match-company` does entity resolution by building a weighted Elasticsearch query:
1. Exact `term` matches for high-confidence fields:
- website (highest boost)
- phone number
- facebook profile
2. Fuzzy `match` on company names for tolerant name matching.

The API returns the top hit (`size: 1`) as the best candidate.
