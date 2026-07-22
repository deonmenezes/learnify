# Learnify content sources and topic-feed semantics

## Exact frontend → provider paths

### Topic research feed

`app/research.html` → `GET /api/research?topic=<exact label>` → `api/research.js` validates the label → `lib/papers.js#collectTopicPapers` builds the mapped OpenAlex requests → OpenAlex Works API → `mapOpenAlexTopicWork` performs trusted normalization and freshness/relevance checks → JSON → the browser applies a second freshness check and renders loading, error, empty, partial, or result states.

There is no application database in this public research path. Vercel caches successful responses for 30 minutes with a one-hour stale-while-revalidate window. Supabase is used separately for optional accounts, profiles, saves, read events, quizzes, and XP; it is not a paper or article source.

OpenAlex is a scholarly metadata index, not the publisher. Exact-topic results are restricted to DOI-bearing articles in sources OpenAlex classifies as core journals. Items are labeled `content_type=paper` / `Research paper`, `provider=OpenAlex`, and `publisher`/venue; `canonical_url` is the DOI. Learnify displays metadata and an available abstract. PubMed/PMC-identified records may be checked against the rights-gated Europe PMC body endpoint described below; every item retains a canonical source link. OpenAlex's core classification is a credibility signal, not an endorsement or guarantee of research quality.

### Main mixed article feed

`app/app.js#articles` → `GET /api/articles` → `api/articles.js` → `lib/feeds.js#collectArticles` → publisher RSS/Atom or public WordPress REST, plus separately labeled research/community tiers → normalization/deduplication/media attribution → JSON.

Publisher article sources currently configured in `lib/feeds.js` are TechCrunch, SiliconValley.com, VentureBeat, The Next Web, Wired, The Verge, Engadget, TechRadar, Gizmodo, Ars Technica, MIT Technology Review, IEEE Spectrum, 9to5Mac, MacRumors, Android Police, Hacker News, Rest of World, Quanta Magazine, ScienceDaily, New Scientist, Phys.org, Live Science, Google DeepMind, Google Research, Tom's Hardware, The Register, and The Hacker News. Publisher items retain their source and `content_type` (`article`, `video`, or `podcast`). The mixed feed can also contain clearly labeled arXiv/OpenAlex papers and public X, Bluesky, or Reddit posts.

The topic research page never falls back to `articles.json`, `papers-enriched.json`, bundled samples, or mock cards. The existing general article client may use `articles.json` as an offline snapshot, but that snapshot is not represented as the live topic feed.

## Rights-gated in-app reading

`app/research.html` opens the existing article detail route for a selected paper. `app/article.html` reloads the exact topic result, keeps a prominent **Read on source** link, and places a reader below **AI Summary**. Publisher-feed articles and papers without a PubMed/PMC identifier always show the restricted/unknown fallback: metadata plus the provider-supplied excerpt or OpenAlex abstract, Learnify summary, and source link.

For an OpenAlex record with a PubMed ID or PMCID, `lib/content-rights.js` marks full text as `verification_required` / `unchecked`; OpenAlex license metadata is only a hint and never grants display permission. The browser calls `GET /api/content?pmcid=PMC…` or `GET /api/content?pmid=…`. That server endpoint accepts exactly one strict identifier, constructs fixed URLs on `www.ebi.ac.uk`, and rejects redirects and arbitrary hosts/URLs. A PMID is resolved to a PMCID through Europe PMC’s bounded JSON search API; then the endpoint retrieves Europe PMC `fullTextXML`. The returned XML must contain an exact Creative Commons license URL in its `<license>` metadata. Supported redistribution licenses are:

- CC0 1.0 (`CC0-1.0`)
- Public Domain Mark 1.0 (`PDM-1.0`)
- Creative Commons Attribution 3.0 (`CC-BY-3.0`)
- Creative Commons Attribution 4.0 (`CC-BY-4.0`)

Other licenses—including CC BY-NC, CC BY-ND, publisher-specific terms, a generic “open access” flag, missing/ambiguous license text, or merely accessible pages—fail closed. Learnify does not fetch publisher HTML, follow provider redirects, bypass paywalls/authentication/anti-bot controls/robots rules, or infer redistribution rights from availability.

The server removes markup and unsafe embedded elements, decodes bounded text, and returns only `heading`, `paragraph`, and `citation` structured plain-text blocks. The response preserves any JATS copyright statement and declares that Learnify reformats the work as structured plain text with figures, tables, and non-text media potentially omitted. The client displays that notice, title/author attribution, license link, and canonical link; it creates DOM elements and assigns body content with `textContent`, never injecting provider HTML. Scripts, styles, iframes, SVG, objects, embeds, event handlers, comments, `javascript:`/`data:` URLs, and arbitrary redirects cannot enter the rendered body.

Outbound Europe PMC requests time out after 10 seconds. PMID metadata requires JSON and is capped at 256 KiB; paper bodies require XML and reject responses over 6 MiB while streaming, and return at most 160 blocks / 120,000 characters and explicitly flag truncation. The endpoint rate-limits each forwarded client to 20 requests per minute per warm instance. Only successfully licensed, sanitized content is held in a bounded 100-entry in-memory cache for one hour; forbidden/raw XML is not persisted. Successful API responses use a one-day edge cache with seven-day stale-while-revalidate. Failures and rights denials use `no-store`.

Normalized records expose `content_type`, `rights_status`, `full_text_status`, `full_text_available`, `license_id`, `license_url`, `canonical_url`, `attribution`, `body_source`, `body_source_url`, `rights_provenance_at`, and (only for a fixed trusted path) `content_endpoint`. A successful body response is the only response that sets `rights_status=verified_open_access`, `full_text_status=available`, and `full_text_available=true`.

This public-content path sends only a PMID or PMCID to Europe PMC and stores no reader content in Supabase. Normal Learnify account/saved/read-event behavior remains governed by the privacy policy. Rights can change or metadata can be corrected; cached copies are short-lived, and rights holders may request removal at `support@techscroll.app`. Takedown requests should identify the canonical URL/PMID/PMCID and the claimed right; Learnify should disable the item while reviewing credible claims.

### Optional expansion

No credential is needed for the supported Europe PMC path. Broader lawful coverage would require a separately reviewed, provider-authorized full-text API plus an explicit host/license allowlist and contract-compatible redistribution terms. Unpaywall can add OA-location metadata with an email configuration, but it does not by itself grant republication rights and is therefore not used as a body source.

## Canonical topics and provider mappings

Each selected topic makes two focused, relevance-ranked OpenAlex searches. Provider-side filters require `type:article`, `has_doi:true`, a core journal source, `is_retracted:false`, `is_paratext:false`, and the rolling lower/upper publication dates. Server normalization independently verifies those properties, requires the topic signal in the title/OpenAlex taxonomy (not merely an abstract aside), and rejects configured false-positive contexts.

| Exact label | OpenAlex search phrases | Representative exclusions |
|---|---|---|
| AI / ML | artificial intelligence machine learning; large language model deep learning | artificial insemination |
| Robotics | robotics autonomous manipulation; robot locomotion human robot interaction | robotic process automation |
| Coding & Dev Tools | software engineering developer tools; programming languages compiler debugging | genetic programming |
| Hardware & Gadgets | semiconductor processor integrated circuit; consumer electronics wearable device | orthopedic hardware; hardware removal |
| Security | cybersecurity malware vulnerability; information security network cryptography | food/social/energy/health/national security |
| Crypto / Web3 | blockchain cryptocurrency smart contract; decentralized finance web3 tokenomics | cryptosporidium |
| Big Tech | big tech antitrust platform regulation; Google Apple Amazon Meta Microsoft competition | platform trials; assay platforms; apple fruit |
| Physics & Space | astrophysics cosmology astronomy; quantum particle physics space science | physical activity; physical education |
| Biology & Life Sciences | molecular cell biology genetics; genomics ecology life sciences | biological parent |
| Chemistry & Materials | chemistry catalysis polymer; materials science nanomaterials | material deprivation; teaching material |
| Neuroscience | neuroscience brain neural circuit; cognitive neuroscience neuroimaging | brain drain |
| Medicine & Health | clinical medicine disease treatment; public health healthcare outcomes | medical education |
| Climate & Environment | climate change biodiversity environment; pollution conservation ecosystem | organizational/investment climate; classroom/business environment |
| Earth Sciences | geology geophysics earth science; oceanography seismology geochemistry | Google Earth |
| Mathematics | mathematics theorem algebra topology; applied mathematics geometry analysis | mathematics education/anxiety |
| Psychology | psychology behavior cognition; mental health psychological wellbeing | price behavior; consumer price |
| Economics | economics macroeconomic monetary policy; labor market economic growth | energy economics |
| Social Sciences | sociology political science inequality; social science governance society | social media marketing |
| Energy | renewable energy battery solar; power grid hydrogen energy storage | energy intake/expenditure; binding energy |
| Startups & Funding | startup venture capital financing; seed funding entrepreneurial finance | unrelated use of “venture capital of the world” |
| Learning & Career | career development workforce skills; learning science vocational education | machine/deep/reinforcement learning |
| Fitness | exercise fitness resistance training; endurance physical activity muscle | fitness functions; evolutionary/ecological/Darwinian fitness |
| Skincare | dermatology skincare skin barrier; sunscreen retinoid cosmetic dermatology | animal skin; fruit skin |

`lib/topics.js` is authoritative for the full include-term lists and exclusions. Mapping is lexical by design and cannot guarantee disciplinary judgment. Empty feeds are preferable to silently broadening a query with unverifiable or obviously irrelevant results.

## Rolling two-year freshness rule

Freshness uses UTC calendar dates. The lower bound is the start of the same UTC calendar date two years earlier, inclusive. Therefore, on 2026-07-21 the lower bound is `2024-07-21T00:00:00.000Z`: a publication dated 2024-07-21 is included and 2024-07-20 is excluded.

OpenAlex requests include both `from_publication_date` and `to_publication_date`, but provider filters are only a bandwidth/quality optimization. The trusted gate is `mapOpenAlexTopicWork` on the server. It accepts strict `YYYY-MM-DD` or UTC ISO timestamps, requires a DOI plus named core journal, and excludes missing, malformed, older-than-cutoff, future, retracted, paratext, non-article, off-topic, and unnormalizable records. Each shipped topic item carries `freshness_verified=true`. The browser rechecks the date and exact topic as defense in depth.

OpenAlex metadata may be corrected after publication, dates may reflect the provider's best indexed publication date, and some works have no abstract or venue. Learnify does not infer a missing date, substitute an upload/update date, or claim comprehensive coverage.

## Environment variables

No environment variable is required for the current public OpenAlex path. Optional:

- `OPENALEX_API_KEY`: appended only to outbound OpenAlex requests if the deployment uses an OpenAlex key.
- `OPENALEX_MAILTO`: polite-pool contact address; defaults to `support@techscroll.app`.

Existing analytics/enrichment variables are unrelated to topic retrieval. Never expose API-key values in responses, logs, docs, or commits.

## Verification

```bash
npm test
node --check api/research.js
node --check lib/papers.js
node --check lib/topics.js
git diff --check

# after deployment
curl -fsS 'https://<production-host>/api/research?topic=AI%20%2F%20ML&limit=3'
curl -fsS 'https://<production-host>/app/research?topic=Skincare'
```

Verify that the API echoes the canonical topic, reports all 23 labels, provides the dynamic cutoff, labels every item as a paper and OpenAlex as provider, and returns only `freshness_verified=true` dates within the window. Unknown topics must return HTTP 400; provider failure must return HTTP 502 rather than mock results.
