# Learnify content sources and topic-feed semantics

## Exact frontend → provider paths

### Topic research feed

`app/research.html` → `GET /api/research?topic=<exact label>` → `api/research.js` validates the label → `lib/papers.js#collectTopicPapers` builds the mapped OpenAlex requests → OpenAlex Works API → `mapOpenAlexTopicWork` performs trusted normalization and freshness/relevance checks → JSON → the browser applies a second freshness check and renders loading, error, empty, partial, or result states.

There is no application database in this public research path. Vercel caches successful responses for 30 minutes with a one-hour stale-while-revalidate window. Supabase is used separately for optional accounts, profiles, saves, read events, quizzes, and XP; it is not a paper or article source.

OpenAlex is a scholarly metadata index, not the publisher. Exact-topic results are restricted to DOI-bearing articles in sources OpenAlex classifies as core journals. Items are labeled `content_type=paper` / `Research paper`, `provider=OpenAlex`, and `publisher`/venue; `canonical_url` is the DOI. Learnify displays metadata and an available abstract, then links out. Milestone 2 does not retrieve or render paper/article bodies. OpenAlex's core classification is a credibility signal, not an endorsement or guarantee of research quality.

### Main mixed article feed

`app/app.js#articles` → `GET /api/articles` → `api/articles.js` → `lib/feeds.js#collectArticles` → publisher RSS/Atom or public WordPress REST, plus separately labeled research/community tiers → normalization/deduplication/media attribution → JSON.

Publisher article sources currently configured in `lib/feeds.js` are TechCrunch, SiliconValley.com, VentureBeat, The Next Web, Wired, The Verge, Engadget, TechRadar, Gizmodo, Ars Technica, MIT Technology Review, IEEE Spectrum, 9to5Mac, MacRumors, Android Police, Hacker News, Rest of World, Quanta Magazine, ScienceDaily, New Scientist, Phys.org, Live Science, Google DeepMind, Google Research, Tom's Hardware, The Register, and The Hacker News. Publisher items retain their source and `content_type` (`article`, `video`, or `podcast`). The mixed feed can also contain clearly labeled arXiv/OpenAlex papers and public X, Bluesky, or Reddit posts.

The topic research page never falls back to `articles.json`, `papers-enriched.json`, bundled samples, or mock cards. The existing general article client may use `articles.json` as an offline snapshot, but that snapshot is not represented as the live topic feed.

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
