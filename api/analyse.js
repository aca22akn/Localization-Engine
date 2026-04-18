'use strict';

require('dotenv').config();

const fetch    = require('node-fetch');
const cheerio  = require('cheerio');
const Anthropic = require('@anthropic-ai/sdk');

// ── Constants ────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT  = 3000;   // ms per page fetch
const MAX_TEXT_CHARS = 40000;  // safety cap on total combined text
const CLAUDE_MODEL   = 'claude-sonnet-4-5';
const MAX_TOKENS     = 4096;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Max sub-pages to fetch (homepage is always fetched separately)
const MAX_PAGES = 5;

// Expanded hardcoded fallback paths — covers Shopify, WooCommerce and custom patterns
const SUB_PATHS = [
  '/about',
  '/pages/about',
  '/pages/about-us',
  '/pages/about-the-brand',
  '/pages/our-story',
  '/pages/story',
  '/our-story',
  '/about-us',
  '/shipping',
  '/pages/shipping',
  '/pages/shipping-and-handling',
  '/pages/shipping-policy',
  '/pages/delivery',
  '/delivery',
  '/pages/delivery-information',
  '/returns',
  '/pages/returns',
  '/pages/return-policy',
  '/pages/returns-and-exchanges',
  '/refund-policy',
  '/pages/refund-policy',
  '/pages/exchange-policy',
  '/contact',
  '/pages/contact',
  '/pages/contact-us',
  '/pages/faq',
  '/faq',
  '/pages/faqs',
  '/pages/terms',
  '/terms-of-service',
  '/pages/terms-and-conditions',
  '/policies/refund-policy',
  '/policies/shipping-policy',
  '/policies/privacy-policy',
];

// ── Anthropic client ─────────────────────────────────────────────────────────

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch a single URL with a timeout. Returns the response text, or null if
 * the fetch fails, times out, or returns a non-2xx status.
 */
async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strip all HTML tags, scripts, styles and excessive whitespace from a
 * combined HTML string, returning plain readable text.
 */
function extractText(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, head').remove();
  const text = $.root().text();
  // Collapse runs of whitespace / newlines into a single space
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Parse the homepage HTML and return all unique internal paths found in
 * navigation elements (nav, header, footer, and elements whose class name
 * contains 'nav', 'menu', 'header', or 'footer').
 */
function extractNavLinks(homeHtml, base) {
  const $ = cheerio.load(homeHtml);
  const seen  = new Set();
  const paths = [];

  const selectors = [
    'nav a[href]',
    'header a[href]',
    'footer a[href]',
    '[class*="nav"] a[href]',
    '[class*="menu"] a[href]',
    '[class*="header"] a[href]',
    '[class*="footer"] a[href]',
  ].join(', ');

  let baseHostname;
  try { baseHostname = new URL(base).hostname; } catch (_) { return []; }

  // Path segments that indicate product/shop/account pages — not useful for brand analysis
  const IRRELEVANT = [
    '/collections/', '/products/', '/cart', '/checkout',
    '/account', '/search', '/blogs/', '/tagged/',
  ];

  $(selectors).each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return;
    // Skip product variant URLs before resolving
    if (href.includes('?variant=')) return;

    let pathname;
    try {
      // Resolve relative hrefs against the base so we get a full URL to inspect
      const resolved = new URL(href, base);
      // Drop links to other domains
      if (resolved.hostname !== baseHostname) return;
      pathname = resolved.pathname;
    } catch (_) {
      return;
    }

    // Ignore root, irrelevant segments, and already-seen paths
    if (!pathname || pathname === '/') return;
    if (IRRELEVANT.some(seg => pathname.includes(seg))) return;
    if (seen.has(pathname)) return;
    seen.add(pathname);
    paths.push(pathname);
  });

  return paths;
}

/**
 * Fetch the homepage + common sub-pages, combine and extract text.
 * Throws an error (to be caught by the route handler) if the homepage
 * itself cannot be reached.
 */
async function scrapeWebsite(baseUrl) {
  const base = baseUrl.replace(/\/$/, '');

  // ── Stage 1: fetch homepage (required) ──────────────────────────────────
  const homeHtml = await fetchPage(base);
  if (homeHtml === null) {
    const err = new Error(
      'We could not reach this website. Please check the URL includes https:// ' +
      'and the site is publicly accessible.'
    );
    err.statusCode = 400;
    throw err;
  }

  // Extract homepage text immediately, capped at 3,000 chars so it cannot
  // crowd out sub-page content from the overall budget.
  const homeText = extractText(homeHtml).slice(0, 3000);

  // ── Stage 1b: extract nav links from homepage HTML ───────────────────────
  const navPaths = extractNavLinks(homeHtml, base);

  // ── Stage 2: merge nav links (priority) + hardcoded fallbacks, deduped ──
  const seenPaths  = new Set(navPaths);
  const allPaths   = [...navPaths];
  for (const path of SUB_PATHS) {
    if (!seenPaths.has(path)) {
      seenPaths.add(path);
      allPaths.push(path);
    }
  }

  // Cap total sub-pages at MAX_PAGES; nav-discovered links fill first slots
  const pathsToFetch = allPaths.slice(0, MAX_PAGES);
  console.log('Pages to fetch:', pathsToFetch);

  // Fetch all sub-pages in parallel; failures are silently skipped
  const subResults = await Promise.all(
    pathsToFetch.map(path => fetchPage(base + path).then(html => ({ path, html })))
  );

  // Extract text from each sub-page individually, capped at 2,000 chars each,
  // and label every section so Claude knows which page each block came from.
  const sections = [
    `PAGE: /\n${homeText}`,
    ...subResults
      .filter(({ html }) => html !== null)
      .map(({ path, html }) => `PAGE: ${path}\n${extractText(html).slice(0, 2000)}`),
  ];

  const combined = sections.join('\n\n');
  return combined.length > MAX_TEXT_CHARS ? combined.slice(0, MAX_TEXT_CHARS) : combined;
}

/**
 * Build the user message, injecting extracted content and brand details.
 */
function buildUserMessage(websiteText, instagramHandle, brandName, pastedContent) {
  const pastedSection = pastedContent
    ? `They have also provided the following content from their social media pages: ${pastedContent}`
    : '';

  return `Important: only make claims about what is present or absent based on what you can actually see in the provided website content. If you cannot find information about something, say the information was not visible in the content provided rather than asserting definitively that it does not exist. Never say a brand has no About page or no policy if you simply did not find it in the text — instead say no About page content was visible in the pages we were able to access. This distinction matters because the brand may have pages we could not reach.

Analyse the following website content from a Pakistani fashion brand that is trying to sell to UK customers. Score them across 9 trust dimensions that British shoppers care about. For each dimension give a score from 1 to 10 where 1 is completely failing UK standards and 10 is excellent. Be harsh and accurate — most Pakistani brands genuinely score between 1 and 4 on most dimensions. Do not inflate scores.

For each dimension provide: the score as a number, a whatIsWrong explanation of exactly what the brand is doing wrong or missing based on what you actually found in their content — be specific, reference actual phrases or missing elements you found, frame each issue as a specific gap or missed opportunity rather than a failure — for example say UK customers cannot find delivery information upfront which leads to cart abandonment rather than there is no delivery information, a fixedVersion which is the actual rewritten copy the brand can copy and paste immediately, and an isLegal flag which is true or false — for the returns dimension this means whether their policy meets the UK Consumer Rights Act 2015 requirement of 14 days no-quibble returns for online purchases, for other dimensions set this to true unless there is a specific legal issue.

Also flag whether you found a Pakistani phone number format — starting with +92 or 0092 or a local Pakistani number — anywhere in the content. If found, this is a significant trust failure for UK customers.

The 9 dimensions to score are:

1 — Tone and communication style. UK customers expect warm, direct, confident and personal language. Formal phrases like 'respected customers', 'kindly be advised', 'we are committed to providing superior quality', or overly corporate language score very low. Generate a rewritten About page or brand bio in natural British English.

2 — Pricing and currency clarity. All prices must be displayed in GBP. Any PKR-only pricing, 'DM for price', or missing currency is an immediate trust failure scoring 1. Generate example product listing copy with correct GBP pricing format.

3 — Delivery information. UK customers need exact delivery timeframes in working days, named courier service, tracking information, and a clear order cutoff time. Vague phrases like '10 to 15 days' or 'worldwide shipping available' score very low. Generate a complete UK delivery information section.

4 — Social proof and reviews. UK customers trust Trustpilot, Google Reviews, or verified on-site reviews with photos and full names. Instagram influencer reposts alone score very low. Generate copy that addresses how the brand should present social proof.

5 — Returns and refund policy. Under the UK Consumer Rights Act 2015, online shoppers have a legal right to 14 days to return goods for any reason. Any policy that is more restrictive than this is not just a trust issue but a legal compliance issue. Score 1 if no policy exists or if it is more restrictive than 14 days. Generate a fully compliant returns policy.

6 — Payment trust signals. UK customers expect card payments via Stripe or PayPal, Apple Pay or Google Pay, and visible security badges. Bank transfer only or COD-focused payment options score very low. Generate copy for a trust-building payment section.

7 — After-sale support. UK customers need a clear, easy way to contact support — email address, response time commitment, and ideally a UK contact option. Pakistani-only contact details or no contact information scores very low. Generate a professional customer support section.

8 — Value narrative. UK Pakistani diaspora customers will pay a premium for authentic Pakistani craftsmanship but need to be convinced the wait and international shipping is worth it. Brands that just list products without telling a story score low. Generate a compelling value narrative paragraph.

9 — Overall brand image. Assess the overall professional impression — website quality signals, spelling and grammar, image quality signals from any alt text or image references found, and whether the brand feels trustworthy to a British shopper. Generate an overall brand positioning statement.

After scoring all 9 dimensions, calculate an overall score as the average of all 9 scores rounded to one decimal place. Generate a two to three sentence overall verdict that is honest, specific, and constructive. Frame it as gaps that are costing the brand UK sales and can be fixed, not as a judgment of the brand overall. Avoid words like fundamentally unsuitable, catastrophic, or completely unprepared.

Return your entire response as valid JSON only, with no markdown formatting, no code blocks, and no text outside the JSON. The structure should be: an object with fields: brandName as string, overallScore as number, verdict as string, pakistaniPhoneNumberFound as boolean, and dimensions as an array of 9 objects each containing: id as number, name as string, score as number, whatIsWrong as string, fixedVersion as string, isLegal as boolean.

Here is the website content to analyse:
${websiteText}

The brand's Instagram handle is ${instagramHandle} and their brand name is ${brandName || 'unknown'}. ${pastedSection}`;
}

/**
 * Attempt to parse JSON from the Claude response text. First tries a direct
 * parse, then falls back to extracting the outermost {...} block.
 */
function parseClaudeJson(text) {
  // Direct parse
  try {
    return JSON.parse(text);
  } catch (_) { /* fall through */ }

  // Extract first { … last }
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (_) { /* fall through */ }
  }

  return null;
}

/**
 * Transform the Claude-shaped JSON into the shape the frontend expects.
 */
function transformToFrontendShape(claude, websiteUrl, instagramHandle) {
  return {
    brand_name:               claude.brandName      || '',
    overall_score:            claude.overallScore   ?? 0,
    verdict:                  claude.verdict        || '',
    website_url:              websiteUrl,
    instagram_handle:         instagramHandle,
    pakistaniPhoneNumberFound: claude.pakistaniPhoneNumberFound ?? false,
    dimensions: (claude.dimensions || []).map(dim => ({
      score:        dim.score       ?? 0,
      issue:        dim.whatIsWrong || '',   // frontend reads dim.issue
      fix:          dim.fixedVersion || '',  // frontend reads dim.fix
      cra_compliant: dim.isLegal    ?? true, // frontend reads dim.cra_compliant
    })),
  };
}

// ── Vercel serverless handler ─────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { websiteUrl, instagramHandle, brandName, pastedContent } = req.body;

  // ── Step A: scrape the website ───────────────────────────────────────────
  let websiteText;
  try {
    websiteText = await scrapeWebsite(websiteUrl);
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message });
  }

  // ── Step B: call Claude ──────────────────────────────────────────────────
  let claudeRaw;
  try {
    const message = await client.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system:
        'You are a specialist in UK e-commerce consumer psychology and cross-cultural brand trust. ' +
        'You have deep knowledge of what makes British shoppers trust or distrust international fashion brands, ' +
        'particularly from South Asia. You know the UK Consumer Rights Act 2015 in detail. ' +
        'You are precise, critical, and specific — you never give generic advice. ' +
        'When you identify a problem you always generate the actual fixed copy the brand can use immediately.',
      messages: [
        {
          role: 'user',
          content: buildUserMessage(websiteText, instagramHandle, brandName, pastedContent),
        },
      ],
    });

    claudeRaw = message.content[0].text;
  } catch (err) {
    console.error('Claude API error:', err);
    return res.status(500).json({ error: 'Analysis failed. Please try again in a moment.' });
  }

  // ── Step C: parse Claude's JSON response ─────────────────────────────────
  const claudeJson = parseClaudeJson(claudeRaw);
  if (!claudeJson) {
    console.error('Failed to parse Claude response:', claudeRaw.slice(0, 500));
    return res.status(500).json({ error: 'Analysis parsing failed.' });
  }

  // ── Step D: transform to frontend shape and return ───────────────────────
  const result = transformToFrontendShape(claudeJson, websiteUrl, instagramHandle);
  return res.status(200).json(result);
};
