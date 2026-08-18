// lib/briefing.js - builds the spoken script for the daily research briefing.
//
// Everything here is pure and synchronous so the script can be inspected, diffed
// and tested without spending a character of ElevenLabs quota. The narration is
// assembled from the SAME world-ranked papers the Research tab shows, so the
// briefing can never drift from what a listener finds when they open the app.
//
// Two things this deliberately does not do:
//   * It does not paraphrase or summarize a paper with an LLM. The abstract's
//     own opening sentence is read, trimmed and attributed, so nothing spoken is
//     a machine's claim about research it did not read.
//   * It does not read URLs, DOIs, LaTeX or citation markers aloud. Those are
//     stripped, because a text-to-speech engine reading "10.1016/j.patter" is
//     both useless and actively unpleasant.

const ORDINALS = [
  "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth",
  "Ninth", "Tenth", "Eleventh", "Twelfth",
];

/**
 * Make provider text safe and pleasant to read aloud.
 *
 * Order matters: URLs and math go before punctuation collapsing, so their
 * leftovers cannot survive as stray symbols in the middle of a sentence.
 */
export function speechSafe(text, limit = 400) {
  let out = String(text || "");
  out = out.replace(/<[^>]+>/g, " ");                       // any stray markup
  out = out.replace(/https?:\/\/\S+/g, " ");                // links
  out = out.replace(/\b10\.\d{4,9}\/\S+/g, " ");            // bare DOIs
  out = out.replace(/\$[^$]{1,120}\$/g, " ");               // inline LaTeX
  out = out.replace(/\\[a-zA-Z]+\{[^}]*\}/g, " ");          // LaTeX commands
  out = out.replace(/\[[^\]]{0,40}\]/g, " ");               // [12], [Fig. 3]
  out = out.replace(/[*_`#|]+/g, " ");                      // markdown leftovers
  out = out.replace(/\bet al\.?/gi, "and colleagues");
  out = out.replace(/\be\.g\.,?/gi, "for example,");
  out = out.replace(/\bi\.e\.,?/gi, "that is,");
  out = out.replace(/\bvs\.?\b/gi, "versus");
  out = out.replace(/[""]/g, '"').replace(/['']/g, "'");
  out = out.replace(/[\u2010\u2011\u2012\u2013\u2014]/g, "-");   // typographic hyphens/dashes
  out = out.replace(/\s-\s/g, ", ");                        // a dash used as a pause
  out = out.replace(/…/g, " ");
  out = out.replace(/\s+/g, " ").trim();
  // Stripping links and bracketed refs orphans their punctuation ("See for
  // details ."), which a synthesizer renders as an audible stumble.
  out = out.replace(/\s+([.,;:!?])/g, "$1");
  out = out.replace(/([.,;:!?])\1+/g, "$1");
  out = out.replace(/,\s*([.!?])/g, "$1");
  out = out.replace(/^[^A-Za-z0-9"']+/, "");                 // leading punctuation
  if (out.length > limit) out = out.slice(0, limit).replace(/\s+\S*$/, "");
  return out.trim();
}

// The first real sentence of an abstract, which is where a paper says what it
// did. Returns "" when the summary is only our own venue filler.
export function leadSentence(summary, limit = 240) {
  const raw = String(summary || "").trim();
  // Google Scholar snippets are elided extracts that routinely BEGIN mid-clause
  // ("… we question this very process cautiously"). Reading one aloud as "in the
  // authors' own words" would be a quote that never existed, so a fragment is
  // dropped rather than patched into a sentence.
  if (/^(?:…|\.\.\.)/.test(raw)) return "";
  let clean = speechSafe(raw, 800);
  if (!clean || /^Published in\b/i.test(clean)) return "";
  clean = clean.replace(/^abstract[:.\s]+/i, "");            // journals prefix "ABSTRACT"
  if (!/^["'(]?[A-Z0-9]/.test(clean)) return "";             // still a fragment
  const match = clean.match(/^[\s\S]{20,}?[.!?](?=\s|$)/);
  const sentence = (match ? match[0] : clean).trim();
  const spoken = speechSafe(sentence, limit);
  return spoken.length >= 30 ? spoken : "";
}

// Small counts read better as words than as digits in synthesized speech.
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
function spokenCount(count) {
  if (count === 1) return "One paper";
  const word = COUNT_WORDS[count] || String(count);
  return `${word.charAt(0).toUpperCase()}${word.slice(1)} papers`;
}

function spokenTitle(title) {
  const clean = speechSafe(title, 220);
  return clean.replace(/[.:;,]+$/, "");
}

function spokenCitations(paper) {
  const citations = Number(paper?.citations) || 0;
  if (!citations) return "It is new enough that the citation count has not caught up yet.";
  const perYear = Number(paper?.score_breakdown?.citations_per_year) || 0;
  const times = citations.toLocaleString("en-US");
  if (perYear >= 10) return `It has ${times} citations, running at about ${Math.round(perYear)} a year.`;
  return `It has ${times} citation${citations === 1 ? "" : "s"} so far.`;
}

// Google Scholar elides long venue names from the middle ("Proceedings of the
// ACM on Software Engineering" arrives as "… of the ACM on Software
// Engineering"). Reading the remainder aloud produces "Published in of the ACM
// on Software Engineering", so a venue that clearly starts mid-phrase is
// dropped instead of spoken.
export function usableVenue(venue) {
  let text = String(venue || "").trim();
  if (!text) return "";
  if (/^[a-z]/.test(text)) return "";                        // elided from the front
  // Elided from the BACK: "ACM Transactions on …" leaves a dangling preposition
  // that reads as an unfinished sentence. Trim it; if nothing usable survives,
  // say nothing rather than say it wrong.
  const dangling = /[\s,]+(?:of|on|in|for|and|the|to|at|with)\s*$/i;
  while (dangling.test(text)) text = text.replace(dangling, "").trim();
  return text.length >= 3 ? text : "";
}

// Facts about the record itself, spoken only when they are true. These are not
// judgements about the research; they are why this paper reached the briefing.
function spokenSignals(paper) {
  // Only the RARE signal is spoken. Open access is true of most papers that
  // reach this list, so saying it eight times in a row is noise; the PDF link
  // is in the chapter metadata, where a listener can actually act on it.
  if (!Array.isArray(paper?.providers) || paper.providers.length < 2) return "";
  return "Both OpenAlex and Google Scholar surfaced this one independently.";
}

function spokenSource(paper) {
  const venue = usableVenue(speechSafe(paper?.venue || paper?.publisher || "", 90));
  const year = Number.isInteger(paper?.published_year)
    ? paper.published_year
    : (paper?.published ? new Date(paper.published).getUTCFullYear() : null);
  if (venue && year) return `Published in ${venue}, ${year}.`;
  if (venue) return `Published in ${venue}.`;
  if (year) return `Published in ${year}.`;
  return "";
}

/**
 * Pick the papers for one briefing.
 *
 * Round-robin across topics BEFORE scoring, so a single hot field cannot take
 * the whole briefing: a listener should hear from several corners of research,
 * not eight variations on one subject. Within that constraint the highest world
 * score wins.
 */
export function selectBriefingPapers(papersByTopic, { limit = 8, maxPerTopic = 2 } = {}) {
  const queues = Object.entries(papersByTopic || {})
    .map(([topic, papers]) => ({
      topic,
      papers: (Array.isArray(papers) ? papers : [])
        .filter((paper) => paper && paper.title && (paper.url || paper.link))
        .slice(0, Math.max(1, maxPerTopic)),
    }))
    .filter((entry) => entry.papers.length);

  const picked = [];
  let round = 0;
  while (picked.length < limit && queues.some((entry) => entry.papers.length > round)) {
    for (const entry of queues) {
      if (picked.length >= limit) break;
      const paper = entry.papers[round];
      if (paper) picked.push({ ...paper, topic: paper.topic || entry.topic });
    }
    round += 1;
  }
  return picked
    .sort((a, b) => (Number(b.world_score) || 0) - (Number(a.world_score) || 0))
    .slice(0, limit);
}

/**
 * Assemble the narration.
 *
 * Returns the exact string sent to the synthesizer plus, for each paper, the
 * CHARACTER OFFSET where its segment begins. The offsets are what turn the
 * provider's character-level alignment into real chapter timestamps, so they
 * must be computed here against the final string rather than estimated later.
 *
 * `maxChars` is a real budget, not a suggestion: papers are dropped from the
 * end until the script fits, because ElevenLabs bills per character.
 */
export function buildBriefingScript(papers, { date = new Date(), maxChars = 5000, edition = "Learnify" } = {}) {
  const day = (date instanceof Date ? date : new Date(date));
  const dateLabel = day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

  const build = (list) => {
    const intro = list.length
      ? `This is your ${edition} research briefing for ${dateLabel}. `
        + `${spokenCount(list.length)}, `
        + `ranked out of everything OpenAlex and Google Scholar indexed in the last two years. Here is what stood out.\n\n`
      : "";
    let text = intro;
    const segments = [];

    list.forEach((paper, index) => {
      const charStart = text.length;
      const parts = [];
      parts.push(`${ORDINALS[index] || `Number ${index + 1}`}, from ${speechSafe(paper.topic || "research", 60)}.`);
      parts.push(`${spokenTitle(paper.title)}.`);
      const source = spokenSource(paper);
      if (source) parts.push(source);
      parts.push(spokenCitations(paper));
      const lead = leadSentence(paper.summary);
      if (lead) parts.push(`In the authors' own words: ${lead}`);
      const signals = spokenSignals(paper);
      if (signals) parts.push(signals);
      const segment = `${parts.join(" ")}\n\n`;
      text += segment;
      segments.push({
        index: index + 1,
        char_start: charStart,
        char_end: text.length,
        id: paper.id,
        title: paper.title,
        topic: paper.topic || null,
        venue: paper.venue || paper.publisher || null,
        citations: Number(paper.citations) || 0,
        world_score: Number.isFinite(paper.world_score) ? paper.world_score : null,
        url: paper.url || paper.link || null,
        open_access_pdf: paper.open_access_pdf || null,
        providers: Array.isArray(paper.providers) ? paper.providers : null,
      });
    });

    const outro = list.length
      ? "That is your briefing. Every paper is linked in the Research tab, where you can switch between best in the world and newest first. See you tomorrow."
      : "";
    text += outro;
    return { text: text.trim(), segments, characters: text.trim().length };
  };

  let list = [...(Array.isArray(papers) ? papers : [])];
  let result = build(list);
  // Drop from the least-important end until the script fits the budget.
  while (result.characters > maxChars && list.length > 1) {
    list = list.slice(0, -1);
    result = build(list);
  }
  return { ...result, dropped: (Array.isArray(papers) ? papers.length : 0) - list.length, date_label: dateLabel };
}
