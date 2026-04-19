/* =========================================================
   UK Market Localization Engine — Frontend Logic
   ========================================================= */

'use strict';

// ── DOM refs ────────────────────────────────────────────────────────────────

const form            = document.getElementById('analysisForm');
const submitBtn       = document.getElementById('submitBtn');
const formError       = document.getElementById('formError');

const emptyState      = document.getElementById('emptyState');
const loadingState    = document.getElementById('loadingState');
const reportOutput    = document.getElementById('reportOutput');
const errorState      = document.getElementById('errorState');
const errorMessage    = document.getElementById('errorMessage');
const retryBtn        = document.getElementById('retryBtn');
const downloadBtn     = document.getElementById('downloadBtn');

const reportBrandName = document.getElementById('reportBrandName');
const reportMeta      = document.getElementById('reportMeta');
const overallScore    = document.getElementById('overallScore');
const reportVerdict   = document.getElementById('reportVerdict');
const scoreSummary    = document.getElementById('scoreSummary');
const dimensionsContainer = document.getElementById('dimensionsContainer');
const reportDate      = document.getElementById('reportDate');

const steps = [
  document.getElementById('step1'),
  document.getElementById('step2'),
  document.getElementById('step3'),
  document.getElementById('step4'),
];

// ── Dimension metadata ───────────────────────────────────────────────────────

const DIMENSIONS = [
  { id: 'tone',          label: 'Tone & Communication Style',    tag: null },
  { id: 'pricing',       label: 'Pricing & Currency Clarity',    tag: null },
  { id: 'delivery',      label: 'Delivery Information',          tag: null },
  { id: 'social_proof',  label: 'Social Proof & Reviews',        tag: null },
  { id: 'returns',       label: 'Returns & Refund Policy',       tag: 'CRA 2015' },
  { id: 'payment',       label: 'Payment Trust Signals',         tag: null },
  { id: 'after_sale',    label: 'After-Sale Support',            tag: null },
  { id: 'value',         label: 'Value Narrative',               tag: null },
  { id: 'brand_image',   label: 'Overall Brand Image',           tag: null },
];

// ── State ────────────────────────────────────────────────────────────────────

let lastFormData   = null;
let lastReportData = null;
let stepTimer      = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

const reportPanel = document.getElementById('reportPanel');

function showPanel(which) {
  emptyState.hidden   = which !== 'empty';
  loadingState.hidden = which !== 'loading';
  reportOutput.hidden = which !== 'report';
  errorState.hidden   = which !== 'error';
  // Always snap the right panel back to the top so the user never
  // has to scroll to find the new state.
  reportPanel.scrollTop = 0;
}

function scoreClass(score) {
  if (score >= 7) return 'high';
  if (score >= 4) return 'mid';
  return 'low';
}

function scoreColor(score) {
  if (score >= 7) return 'var(--score-high)';
  if (score >= 4) return 'var(--score-mid)';
  return 'var(--score-low)';
}

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

// ── Loading step animation ───────────────────────────────────────────────────

function startLoadingAnimation(instagramHandle) {
  // step2 (index 1) is "Reviewing Instagram presence" — hide it if no handle provided
  const hasInstagram = !!instagramHandle;
  steps[1].hidden = !hasInstagram;

  const activeSteps = hasInstagram ? steps : steps.filter((_, i) => i !== 1);

  activeSteps.forEach(s => { s.classList.remove('active', 'done'); });
  activeSteps[0].classList.add('active');

  let current = 0;
  stepTimer = setInterval(() => {
    activeSteps[current].classList.remove('active');
    activeSteps[current].classList.add('done');
    current++;
    if (current < activeSteps.length) {
      activeSteps[current].classList.add('active');
    } else {
      clearInterval(stepTimer);
    }
  }, 6000); // advance every 6 s
}

function stopLoadingAnimation() {
  clearInterval(stepTimer);
  steps.forEach(s => { s.classList.remove('active', 'done'); });
}

// ── Copy to clipboard ────────────────────────────────────────────────────────

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.innerHTML;
    btn.textContent = 'Copied!';
    btn.style.background = '#15803d';
    setTimeout(() => {
      btn.innerHTML = orig;
      btn.style.background = '';
    }, 2000);
  });
}

// ── Render report ────────────────────────────────────────────────────────────

function renderReport(data) {
  lastReportData = data;

  // Header
  reportBrandName.textContent = data.brand_name || 'Your Brand';
  reportMeta.textContent      =
    (data.website_url || '') +
    (data.website_url && data.instagram_handle ? '  ·  ' : '') +
    (data.instagram_handle ? '@' + data.instagram_handle : '');

  // Overall score
  const avg = data.overall_score ?? computeAvg(data.dimensions);
  overallScore.textContent = avg.toFixed(1);

  // Colour the overall score
  overallScore.style.color =
    avg >= 7 ? '#7dd3a8' :
    avg >= 4 ? '#fcd34d' : '#f87171';

  // Verdict
  reportVerdict.innerHTML = data.verdict || '';

  // Score summary mini bars
  scoreSummary.innerHTML = '';
  data.dimensions.forEach((dim, i) => {
    const meta    = DIMENSIONS[i] || { label: dim.label };
    const cls     = scoreClass(dim.score);
    const pct     = clamp((dim.score / 10) * 100, 0, 100);
    const mini    = document.createElement('div');
    mini.className = 'score-mini';
    mini.innerHTML = `
      <div class="score-mini__bar-wrap" title="${meta.label}: ${dim.score}/10">
        <div class="score-mini__bar-fill" style="height:${pct}%; background:${scoreColor(dim.score)}"></div>
      </div>
      <div class="score-mini__num" style="color:${scoreColor(dim.score)}">${dim.score}</div>
      <div class="score-mini__label">${abbreviate(meta.label)}</div>
    `;
    scoreSummary.appendChild(mini);
  });

  // Dimension cards
  dimensionsContainer.innerHTML = '';
  data.dimensions.forEach((dim, i) => {
    const meta  = DIMENSIONS[i] || { label: dim.label, tag: null };
    const cls   = scoreClass(dim.score);
    const card  = buildDimensionCard(dim, meta, i + 1, cls);
    dimensionsContainer.appendChild(card);
  });

  // Date
  reportDate.textContent = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  showPanel('report');
}

function abbreviate(label) {
  // Short abbreviation for the mini bar labels
  const map = {
    'Tone & Communication Style':  'Tone',
    'Pricing & Currency Clarity':  'Pricing',
    'Delivery Information':        'Delivery',
    'Social Proof & Reviews':      'Social',
    'Returns & Refund Policy':     'Returns',
    'Payment Trust Signals':       'Payment',
    'After-Sale Support':          'Support',
    'Value Narrative':             'Value',
    'Overall Brand Image':         'Image',
  };
  return map[label] || label.split(' ')[0];
}

function computeAvg(dims) {
  if (!dims || dims.length === 0) return 0;
  return dims.reduce((s, d) => s + (d.score || 0), 0) / dims.length;
}

function buildDimensionCard(dim, meta, num, cls) {
  const card = document.createElement('div');
  card.className = `dimension-card dimension-card--${cls}`;

  // CRA compliance badge (returns dimension only)
  let craBadge = '';
  if (meta.id === 'returns' && dim.cra_compliant !== undefined) {
    craBadge = dim.cra_compliant
      ? `<div class="cra-badge cra-badge--pass">&#10003; CRA 2015 Compliant</div>`
      : `<div class="cra-badge cra-badge--fail">&#10007; Not CRA 2015 Compliant</div>`;
  }

  // Tag chip
  const tagHtml = meta.tag
    ? `<span class="dimension-tag">${meta.tag}</span>`
    : '';

  // Fix copy button
  const fixId = `fix-${num}`;

  card.innerHTML = `
    <div class="dimension-card__header">
      <div class="dimension-card__left">
        <div class="dimension-num">${num}</div>
        <div class="dimension-name">${meta.label}</div>
        ${tagHtml}
      </div>
      <div class="dimension-card__right">
        <div class="score-pill score-pill--${cls}">
          ${dim.score}<span class="score-denom">/10</span>
        </div>
        <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </div>
    <div class="dimension-card__body">
      ${craBadge}
      <div>
        <div class="body-section__label body-section__label--issue">What's wrong</div>
        <div class="issue-text">${dim.issue || 'No issues found.'}</div>
      </div>
      <div>
        <div class="body-section__label body-section__label--fix">Fixed version</div>
        <div class="fix-box">
          <div class="fix-box__content" id="${fixId}">${escapeHtml(dim.fix || '—')}</div>
          <div class="fix-box__copy">
            <button class="btn-copy" data-fix="${fixId}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Copy
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Toggle collapse
  const header = card.querySelector('.dimension-card__header');
  header.addEventListener('click', () => {
    card.classList.toggle('open');
  });

  // Copy button
  const copyBtn = card.querySelector('.btn-copy');
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const contentEl = document.getElementById(copyBtn.dataset.fix);
    copyText(contentEl.textContent, copyBtn);
  });

  // Auto-open low-scoring cards
  if (dim.score < 5) card.classList.add('open');

  return card;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Download report ──────────────────────────────────────────────────────────

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

function downloadReport() {
  if (!lastReportData) return;
  const safe = (lastReportData.brand_name || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const element = document.getElementById('reportOutput');
  const opt = {
    margin:     10,
    filename:   `uk-report-${safe}.pdf`,
    image:      { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF:      { unit: 'mm', format: 'a4', orientation: 'portrait' },
  };
  html2pdf().set(opt).from(element).save();
}

downloadBtn.addEventListener('click', downloadReport);

// ── API call ─────────────────────────────────────────────────────────────────

async function runAnalysis(websiteUrl, instagramHandle, brandName) {
  const response = await fetch('/api/analyse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ websiteUrl, instagramHandle, brandName }),
  });

  if (!response.ok) {
    let msg = `Server error (${response.status})`;
    try {
      const err = await response.json();
      msg = err.error || msg;
    } catch (_) { /* ignore */ }
    throw new Error(msg);
  }

  return response.json();
}

// ── Demo / fallback data (used when no backend is connected) ─────────────────

function buildDemoReport(websiteUrl, instagramHandle, brandName) {
  const name = brandName || inferBrandName(websiteUrl, instagramHandle);
  return {
    brand_name:       name,
    website_url:      websiteUrl,
    instagram_handle: instagramHandle,
    overall_score:    4.2,
    verdict: `<strong>${name}</strong> shows strong craftsmanship and visual identity, but significant trust gaps will cost you UK conversions. Your pricing is in PKR, your returns policy is non-existent, and your tone reads as overly formal to British eyes. The good news: these are all fixable. Apply the generated copy below and you'll immediately strengthen credibility with UK shoppers.`,
    dimensions: [
      {
        score: 4,
        label: 'Tone & Communication Style',
        issue: 'Your About page reads as formal corporate Pakistani business English — phrases like "We are committed to providing superior quality garments to our esteemed clientele" feel stiff and distant to UK buyers. British shoppers expect warmth, directness and personality.',
        fix: `We make clothes for real life.\n\nStarted in Lahore, built for London — ${name} is a Pakistani fashion brand that believes getting dressed should feel effortless. Every piece is cut from fabrics we'd wear ourselves, with the kind of detail that only shows up when you look twice.\n\nWe ship to the UK in 5–7 days. Free returns within 14 days. No fuss.`,
        cra_compliant: false,
      },
      {
        score: 2,
        label: 'Pricing & Currency Clarity',
        issue: 'All prices are displayed in PKR (Pakistani Rupees) with no GBP equivalent. UK customers will immediately leave — they will not do currency conversion mentally. Showing foreign currency signals that you are not set up for UK sales.',
        fix: `Display prices in GBP first, e.g. "£42.00 (approx. PKR 14,800)". Use Shopify's multi-currency or a GBP-only store for UK traffic. Add a currency selector in the header. Example product listing:\n\nLinen Co-ord Set — £58.00\nFree UK delivery on orders over £60 · 14-day free returns`,
      },
      {
        score: 3,
        label: 'Delivery Information',
        issue: 'Delivery information is buried in the FAQ, mentions only approximate timeframes ("15–25 working days"), and does not name a courier. UK customers expect clear, specific timelines and a trackable service from the homepage.',
        fix: `UK Delivery\n————————\n✓ Standard: 5–8 working days — £3.99\n✓ Express: 2–3 working days — £7.99\n✓ Free standard delivery on orders over £60\n\nAll orders are dispatched within 24 hours and sent with Royal Mail Tracked. You'll receive a tracking number by email as soon as your order ships.`,
      },
      {
        score: 3,
        label: 'Social Proof & Reviews',
        issue: 'Your Instagram has strong imagery but zero customer reviews or testimonials are visible on the website. There is no Trustpilot badge, star ratings on product pages, or UGC. UK shoppers heavily rely on social proof before purchasing from an unfamiliar international brand.',
        fix: `Add to your homepage and product pages:\n\n★★★★★  "The fabric quality is unreal for the price. I ordered the shalwar suit and it arrived beautifully packaged. Will definitely be ordering again." — Priya M., Manchester\n\n★★★★★  "Finally a Pakistani brand that actually ships to the UK quickly. The embroidery is even more beautiful in person." — Fatima K., Birmingham\n\nAlso: install the Trustpilot or Judge.me app, and add a 'As seen on Instagram' UGC gallery to your homepage.`,
      },
      {
        score: 1,
        label: 'Returns & Refund Policy',
        issue: 'Your current returns policy states "No returns on sale items" and requires customers to contact you within 3 days of delivery — this directly violates the UK Consumer Rights Act 2015, which gives online shoppers a statutory 14-day right to return goods, no questions asked. Selling to UK customers without a compliant policy exposes you to legal risk.',
        cra_compliant: false,
        fix: `RETURNS & REFUND POLICY\n———————————————\n\nWe want you to love your order. If something isn't right, here's how we handle it:\n\n14-Day Returns\nYou have 14 days from the date you receive your order to return any item for a full refund — no questions asked. This is your right under the UK Consumer Rights Act 2015.\n\nHow to Return\n1. Email us at returns@yourbrand.com with your order number\n2. We'll reply within 24 hours with a prepaid returns label\n3. Post your item back in its original condition\n4. Your refund will be processed within 5–7 business days\n\nExchanges\nWant a different size or colour? We'll process an exchange at no extra charge.\n\nFaulty Items\nIf your item arrives damaged or faulty, please email us with a photo within 48 hours. We'll send a replacement or full refund immediately.\n\nSale Items\nSale items are eligible for exchange or store credit. Full refunds are available if the item is faulty.`,
      },
      {
        score: 3,
        label: 'Payment Trust Signals',
        issue: 'No payment method logos are visible on the website. There is no SSL trust badge, no secure checkout messaging, and the checkout page does not show accepted cards. UK consumers are highly attuned to payment security signals.',
        fix: `Add to your footer and checkout page:\n\n🔒 Secure Checkout — SSL Encrypted\n\n[Visa] [Mastercard] [PayPal] [Apple Pay] [Klarna]\n\nYour payment details are always safe. We use Stripe for all transactions — your card details are never stored on our servers.\n\nAlso: enable Klarna or Clearpay for buy-now-pay-later — this significantly increases average order value with UK shoppers.`,
      },
      {
        score: 4,
        label: 'After-Sale Support',
        issue: 'Customer support is listed only as a WhatsApp number with Pakistani country code (+92). UK customers expect a local contact method, guaranteed response times, and professional email support. A +92 number suggests you are not UK-based and raises fulfilment concerns.',
        fix: `Need help? We've got you.\n\n📧 Email: hello@yourbrand.co.uk\n   We reply within 4 business hours, Monday–Friday 9am–6pm GMT\n\n💬 WhatsApp: Available Monday–Saturday, 10am–8pm GMT\n   [Use a UK virtual number via WhatsApp Business]\n\nFor returns & exchanges: returns@yourbrand.co.uk\nFor wholesale enquiries: trade@yourbrand.co.uk`,
      },
      {
        score: 5,
        label: 'Value Narrative',
        issue: 'The website does not explain why Pakistani fashion is a compelling choice for UK buyers — the story of skilled craftsmanship, heritage fabrics and artisan production is completely absent. This is your biggest competitive advantage and you are not using it.',
        fix: `Why choose ${name}?\n\nEvery piece in our collection is handcrafted in Lahore by artisans with decades of experience in traditional embroidery and fabric cutting. The fabrics — pure lawn, silk chiffon, hand-loomed cotton — are sourced directly from the mills that supply Pakistan's finest designers.\n\nWhen you buy from us, you're not paying for a brand name. You're paying for the craft.\n\nFree UK shipping · 14-day returns · Handmade in Lahore`,
      },
      {
        score: 5,
        label: 'Overall Brand Image',
        issue: 'Photography quality is strong on Instagram but the website design looks dated — small fonts, cluttered layout, and no mobile optimisation. The logo is low-resolution. Overall impression: a talented brand that has not yet invested in UK-ready presentation.',
        fix: `Priority fixes for brand image:\n\n1. Upgrade to a Shopify Dawn or Prestige theme — optimised for fashion, mobile-first\n2. Re-export your logo at 2x resolution (SVG preferred)\n3. Add a homepage hero with a single, powerful full-bleed image and one headline\n4. Use a consistent 3-colour palette across site and Instagram\n5. Add a "As Featured In" bar if you have any press mentions\n6. Remove all Pakistani phone numbers and PKR prices from the UK version\n\nTarget: your site should feel indistinguishable from a British-born fashion brand.`,
      },
    ],
  };
}

function inferBrandName(url, handle) {
  if (handle) return handle.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  if (url) {
    try {
      const host = new URL(url).hostname.replace('www.', '');
      return host.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    } catch (_) { /* ignore */ }
  }
  return 'Your Brand';
}

// ── Form submission ──────────────────────────────────────────────────────────

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.hidden = true;

  const websiteUrl      = form.websiteUrl.value.trim();
  const instagramHandle = form.instagramHandle.value.trim().replace(/^@/, '');
  const brandName       = form.brandName.value.trim();

  // Basic validation
  if (!websiteUrl) {
    formError.hidden = false;
    return;
  }

  lastFormData = { websiteUrl, instagramHandle, brandName };

  submitBtn.disabled = true;
  showPanel('loading');
  startLoadingAnimation(instagramHandle);

  try {
    let reportData;
    try {
      reportData = await runAnalysis(websiteUrl, instagramHandle, brandName);
    } catch (apiErr) {
      // If no backend yet, fall back to demo data (remove this block once API is wired)
      console.warn('Backend not available, using demo data:', apiErr.message);
      // Simulate analysis time
      await new Promise(r => setTimeout(r, 3000));
      reportData = buildDemoReport(websiteUrl, instagramHandle, brandName);
    }

    stopLoadingAnimation();
    renderReport(reportData);

  } catch (err) {
    stopLoadingAnimation();
    errorMessage.textContent = err.message || 'An unexpected error occurred. Please try again.';
    showPanel('error');

  } finally {
    submitBtn.disabled = false;
  }
});

// Retry button
retryBtn.addEventListener('click', () => {
  showPanel('empty');
});

// ── Init ─────────────────────────────────────────────────────────────────────

showPanel('empty');
