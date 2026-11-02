#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const USAGE = [
  "Usage: responsive_audit.mjs --base-url <http://localhost:3000> [options]",
  "",
  "Targets:",
  "  --base-url <url>            Origin the routes are resolved against (required).",
  "  --route <path>              Route to audit; repeatable. Default: /",
  "  --routes-file <file>        File with one route per line (# comments allowed),",
  "                              or a JSON array of routes / {route,label} objects.",
  "",
  "Viewports:",
  "  --preset quick|standard|full|mobile   Default: standard",
  "  --viewport <w>x<h>[@name]   Explicit viewport; repeatable; replaces the preset.",
  "",
  "Page readiness / session:",
  "  --ready-selector <css>      Wait for this selector before auditing.",
  "  --settle-ms <n>             Extra settle time after load (default 500).",
  "  --wait-until <state>        domcontentloaded|load|networkidle (default load).",
  "  --storage-state <file>      Playwright storageState JSON for an authenticated run.",
  "",
  "Output:",
  "  --out <dir>                 New/empty directory for screenshots + report.json.",
  "  --full-page                 Also capture a full-page screenshot per route/viewport.",
  "  --screenshot never|issues|always   Default: always.",
  "  --baseline <report.json>    Diff this run against a previous report.",
  "  --fail-on error|warning|never      Default: error.",
  "  --quiet                     Only print the summary and the report path.",
].join("\n");

function fail(message, code = 2) {
  if (message) console.error(message);
  if (code === 2) console.error(USAGE);
  process.exit(code);
}

function argValue(name, fallback = null) {
  const index = process.argv.lastIndexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail(`Missing value for ${name}.`);
  return value;
}

function argValues(name) {
  const values = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for ${name}.`);
    values.push(value);
  }
  return values;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const VALUE_FLAGS = new Set([
  "--base-url",
  "--route",
  "--routes-file",
  "--preset",
  "--viewport",
  "--ready-selector",
  "--settle-ms",
  "--wait-until",
  "--storage-state",
  "--out",
  "--baseline",
  "--fail-on",
  "--screenshot",
  "--chrome",
]);
const BOOLEAN_FLAGS = new Set(["--help", "-h", "--full-page", "--quiet"]);

function validateArgv() {
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (VALUE_FLAGS.has(arg)) {
      index += 1;
      continue;
    }
    if (BOOLEAN_FLAGS.has(arg)) continue;
    fail(`Unknown option: ${arg}`);
  }
}

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(USAGE);
  process.exit(0);
}
validateArgv();

function loadPlaywright() {
  const requirers = [
    createRequire(`${process.cwd()}/package.json`),
    createRequire(import.meta.url),
  ];
  const candidates = ["@playwright/test", "playwright", "playwright-core"];
  const attempts = [];
  for (const requireFrom of requirers) {
    for (const name of candidates) {
      try {
        const mod = requireFrom(name);
        if (mod?.chromium) return mod;
        attempts.push(`${name}: no chromium export`);
      } catch (error) {
        attempts.push(`${name}: ${String(error.message).split("\n")[0]}`);
      }
    }
  }
  fail(
    "No Playwright driver found. Run this from a project that depends on @playwright/test,\n" +
      "playwright, or playwright-core. Do not add the dependency without authorization.\n" +
      `Attempts:\n  - ${attempts.join("\n  - ")}`,
  );
}

function findSystemChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    process.env.PROGRAMFILES &&
      path.join(
        process.env.PROGRAMFILES,
        "Google/Chrome/Application/chrome.exe",
      ),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

const PRESETS = {
  quick: [
    [390, 844],
    [1280, 800],
  ],
  mobile: [
    [320, 568],
    [375, 667],
    [390, 844],
    [430, 932],
  ],
  standard: [
    [320, 568],
    [390, 844],
    [768, 1024],
    [1280, 800],
  ],
  full: [
    [320, 568],
    [375, 667],
    [390, 844],
    [430, 932],
    [768, 1024],
    [820, 1180],
    [1024, 768],
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ],
};

function viewportName(width, height) {
  const kind = width < 768 ? "mobile" : width < 1024 ? "tablet" : "desktop";
  return `${kind}-${width}x${height}`;
}

function toViewport(width, height, name) {
  const isMobile = width < 1024;
  return {
    name: name || viewportName(width, height),
    width,
    height,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: width < 768 ? 2 : 1,
  };
}

function parseViewports() {
  const explicit = argValues("--viewport");
  if (explicit.length) {
    return explicit.map((raw) => {
      const match = /^(\d{2,5})x(\d{2,5})(?:@([\w.-]+))?$/.exec(raw.trim());
      if (!match)
        fail(
          `Invalid --viewport value: ${raw} (expected 390x844 or 390x844@phone)`,
        );
      return toViewport(Number(match[1]), Number(match[2]), match[3]);
    });
  }
  const preset = argValue("--preset", "standard");
  if (!PRESETS[preset]) fail(`Unknown --preset: ${preset}`);
  return PRESETS[preset].map(([width, height]) => toViewport(width, height));
}

function parseRoutes() {
  const routes = argValues("--route");
  const file = argValue("--routes-file");
  if (file) {
    if (!fs.existsSync(file)) fail(`--routes-file does not exist: ${file}`);
    const raw = fs.readFileSync(file, "utf8").trim();
    if (raw.startsWith("[")) {
      for (const entry of JSON.parse(raw)) {
        routes.push(typeof entry === "string" ? entry : entry.route);
      }
    } else {
      for (const line of raw.split("\n")) {
        const value = line.trim();
        if (!value || value.startsWith("#")) continue;
        routes.push(value);
      }
    }
  }
  const unique = [...new Set(routes.filter(Boolean))];
  return unique.length ? unique : ["/"];
}

const baseUrl = argValue("--base-url");
if (!baseUrl) fail("--base-url is required.");
let origin;
try {
  origin = new URL(baseUrl);
} catch {
  fail(`Invalid --base-url: ${baseUrl}`);
}

const routes = parseRoutes();
const viewports = parseViewports();
const readySelector = argValue("--ready-selector");
const settleMs = Number(argValue("--settle-ms", "500"));
if (!Number.isFinite(settleMs) || settleMs < 0)
  fail("--settle-ms must be a non-negative number.");
const waitUntil = argValue("--wait-until", "load");
if (
  !["domcontentloaded", "load", "networkidle", "commit"].includes(waitUntil)
) {
  fail(`Invalid --wait-until: ${waitUntil}`);
}
const storageStatePath = argValue("--storage-state");
if (storageStatePath && !fs.existsSync(storageStatePath))
  fail(`--storage-state does not exist: ${storageStatePath}`);
const screenshotMode = argValue("--screenshot", "always");
if (!["never", "issues", "always"].includes(screenshotMode))
  fail(`Invalid --screenshot: ${screenshotMode}`);
const fullPage = hasFlag("--full-page");
const quiet = hasFlag("--quiet");
const failOn = argValue("--fail-on", "error");
if (!["error", "warning", "never"].includes(failOn))
  fail(`Invalid --fail-on: ${failOn}`);
const baselinePath = argValue("--baseline");
if (baselinePath && !fs.existsSync(baselinePath))
  fail(`--baseline does not exist: ${baselinePath}`);
const outDir = argValue(
  "--out",
  path.join(
    os.tmpdir(),
    `responsive-qa-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`,
  ),
);
if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
  fail(
    `Output directory is not empty: ${outDir}. Use a new directory so stale evidence cannot be mistaken for this run.`,
    2,
  );
}
fs.mkdirSync(outDir, { recursive: true });

function slug(value) {
  const cleaned = value
    .replace(/^https?:\/\//, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (cleaned || "root").slice(0, 60);
}

function auditRenderedPage({ viewportName, requestedWidth, isMobile }) {
  const issues = [];
  const docEl = document.documentElement;
  const clientWidth = docEl.clientWidth;

  const meta = {
    viewport: viewportName,
    requestedWidth,
    href: location.href,
    title: document.title,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientWidth,
    scrollWidth: docEl.scrollWidth,
    scrollHeight: docEl.scrollHeight,
    overflowX: docEl.scrollWidth - clientWidth,
    devicePixelRatio: window.devicePixelRatio,
    metaViewport:
      document.querySelector('meta[name="viewport"]')?.content || null,
    visualViewport: window.visualViewport
      ? {
          width: Math.round(window.visualViewport.width),
          scale: window.visualViewport.scale,
        }
      : null,
    h1:
      document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ||
      null,
    bodyTextLength: (document.body?.innerText || "").trim().length,
  };

  function add(type, severity, detail, extra = {}) {
    issues.push({ viewport: viewportName, type, severity, detail, ...extra });
  }

  function clean(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) < 0.05
    )
      return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 2 && rect.height <= 2) return false;
    return rect.width > 0 && rect.height > 0;
  }

  function describe(el) {
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 3; depth += 1) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += `#${node.id}`;
        parts.unshift(part);
        break;
      }
      const classes =
        typeof node.className === "string"
          ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 3)
          : [];
      if (classes.length) part += `.${classes.join(".")}`;
      const testId = node.getAttribute("data-testid");
      if (testId) part += `[data-testid="${testId}"]`;
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ").slice(0, 220);
  }

  function box(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      right: Math.round(rect.right),
    };
  }

  function ownText(el) {
    return clean(
      [...el.childNodes]
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent)
        .join(" "),
    );
  }

  function renderedLineCount(el) {
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const tops = [];
    let node = walker.nextNode();
    while (node) {
      if (clean(node.textContent)) {
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && rect.height > 0)
            tops.push(Math.round(rect.top));
        }
      }
      node = walker.nextNode();
    }
    const rows = [];
    for (const top of tops.sort((a, b) => a - b)) {
      if (!rows.length || Math.abs(rows[rows.length - 1] - top) > 4)
        rows.push(top);
    }
    return rows.length;
  }

  const visibleElements = [...document.body.querySelectorAll("*")].filter(
    isVisible,
  );

  auditViewportMeta();
  auditPageOverflow();
  auditScrollContainers();
  auditTextAndTypography();
  auditTables();
  auditImages();
  auditTouchTargets();
  auditOverlaps();
  auditStylesheetOnlyDefects();

  return { meta, issues };

  function auditViewportMeta() {
    if (!isMobile) return;
    if (!meta.metaViewport) {
      add(
        "viewport-meta-missing",
        "error",
        'No <meta name="viewport"> is present, so a phone renders the desktop layout scaled down.',
      );
      return;
    }
    if (/user-scalable\s*=\s*(no|0)/i.test(meta.metaViewport)) {
      add(
        "zoom-disabled",
        "warning",
        `Viewport meta disables pinch zoom (${meta.metaViewport}). WCAG 1.4.4 expects users to reach 200% zoom.`,
      );
    }
    const maxScale = /maximum-scale\s*=\s*([\d.]+)/i.exec(meta.metaViewport);
    if (maxScale && Number(maxScale[1]) < 2) {
      add(
        "zoom-capped",
        "warning",
        `Viewport meta caps zoom at ${maxScale[1]}x (${meta.metaViewport}).`,
      );
    }
    const widthDelta = Math.abs(meta.innerWidth - requestedWidth);
    if (widthDelta > 24) {
      add(
        "effective-viewport-mismatch",
        "error",
        `Requested ${requestedWidth}px but innerWidth is ${meta.innerWidth}px. The run is not testing the intended width.`,
      );
    }
  }

  function auditPageOverflow() {
    if (meta.overflowX <= 1) return;
    const tolerance = 2;
    const flagged = new Set();
    const records = [];
    for (const el of visibleElements) {
      const style = getComputedStyle(el);
      if (style.position === "fixed") continue;
      const rect = el.getBoundingClientRect();
      const overhang = Math.round(
        Math.max(rect.right - clientWidth, -rect.left),
      );
      if (overhang <= tolerance) continue;
      if (insideClippedAncestor(el)) continue;
      flagged.add(el);
      records.push({ el, overhang, style, rect });
    }
    const roots = records.filter(({ el }) => {
      let parent = el.parentElement;
      while (parent) {
        if (flagged.has(parent)) return false;
        parent = parent.parentElement;
      }
      return true;
    });
    if (!roots.length) {
      add(
        "page-horizontal-overflow",
        "error",
        `Document scrolls ${meta.overflowX}px horizontally, but no visible element extends past the viewport. Look for a margin, transform, or pseudo-element.`,
        { box: null },
      );
      return;
    }
    for (const record of roots.slice(0, 8)) {
      const { el, overhang, style } = record;
      const text = clean(el.textContent).slice(0, 80);
      const longToken = (text.match(/\S{28,}/) || [])[0] || null;
      add(
        "page-horizontal-overflow",
        "error",
        `Element extends ${overhang}px past the ${clientWidth}px viewport, forcing horizontal page scroll.`,
        {
          selector: describe(el),
          text,
          box: box(el),
          culprit: {
            width: style.width,
            minWidth: style.minWidth,
            maxWidth: style.maxWidth,
            display: style.display,
            position: style.position,
            whiteSpace: style.whiteSpace,
            flexShrink: style.flexShrink,
            gridTemplateColumns:
              style.gridTemplateColumns !== "none"
                ? style.gridTemplateColumns
                : undefined,
            unbreakableToken: longToken || undefined,
          },
        },
      );
    }
    if (roots.length > 8) {
      add(
        "page-horizontal-overflow",
        "warning",
        `${roots.length - 8} further top-level elements also extend past the viewport; fix the reported ones first and re-run.`,
      );
    }
  }

  function insideClippedAncestor(el) {
    let parent = el.parentElement;
    while (parent && parent !== document.documentElement) {
      if (getComputedStyle(parent).overflowX !== "visible") return true;
      parent = parent.parentElement;
    }
    return false;
  }

  function auditScrollContainers() {
    for (const el of visibleElements) {
      const style = getComputedStyle(el);
      const overflowX = style.overflowX;
      const hidden = overflowX === "hidden" || overflowX === "clip";
      const scrollable = overflowX === "auto" || overflowX === "scroll";
      const overhang = el.scrollWidth - el.clientWidth;
      if (overhang <= 2) continue;
      if (hidden) {
        if (style.textOverflow === "ellipsis") continue;
        const text = clean(el.textContent).slice(0, 80);
        if (!text) continue;
        add(
          "content-clipped-horizontally",
          "warning",
          `Content is ${overhang}px wider than this container and overflow-x is ${overflowX}, so the overflow is unreachable.`,
          { selector: describe(el), text, box: box(el) },
        );
      } else if (scrollable && isMobile) {
        add(
          "horizontal-scroll-region",
          "info",
          `Container scrolls horizontally by ${overhang}px on this viewport. Confirm this is the intended mobile strategy.`,
          { selector: describe(el), box: box(el) },
        );
      }
    }
  }

  function auditTextAndTypography() {
    const textSelector =
      "h1,h2,h3,h4,h5,h6,p,li,span,a,button,label,td,th,dd,dt,figcaption,small";
    const seen = new Set();
    for (const el of [...document.querySelectorAll(textSelector)].filter(
      isVisible,
    )) {
      const text = ownText(el);
      if (!text || text.length < 3) continue;
      const style = getComputedStyle(el);
      const fontSize = Number.parseFloat(style.fontSize) || 0;
      const selector = describe(el);
      const key = `${selector}|${text.slice(0, 24)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const overflowY = el.scrollHeight - el.clientHeight;
      if (overflowY > 3 && ["hidden", "clip"].includes(style.overflowY)) {
        const deliberate =
          (style.webkitLineClamp && style.webkitLineClamp !== "none") ||
          style.textOverflow === "ellipsis";
        add(
          deliberate ? "text-truncated" : "text-clipped",
          deliberate ? "info" : "error",
          `Text exceeds its container height by ${Math.round(overflowY)}px and is cut off.`,
          { selector, text: text.slice(0, 100), box: box(el) },
        );
      }

      if (isMobile && fontSize > 0 && fontSize < 12 && text.length > 8) {
        add(
          fontSize < 10 ? "text-too-small" : "text-small",
          fontSize < 10 ? "error" : "warning",
          `Rendered at ${fontSize}px on a ${requestedWidth}px viewport.`,
          { selector, text: text.slice(0, 100), box: box(el) },
        );
      }

      if (
        isMobile &&
        /^H[12]$/.test(el.tagName) &&
        fontSize > requestedWidth / 9
      ) {
        add(
          "heading-oversized-on-mobile",
          "warning",
          `${el.tagName} renders at ${fontSize}px on a ${requestedWidth}px viewport. Confirm the intended mobile type scale.`,
          { selector, text: text.slice(0, 100), box: box(el) },
        );
      }

      const isControl =
        el.tagName === "BUTTON" ||
        ["button", "tab", "menuitem"].includes(el.getAttribute("role") || "") ||
        (el.tagName === "A" &&
          /btn|button|chip|pill|tab|badge/i.test(String(el.className)));
      if (isControl && text.length <= 40 && renderedLineCount(el) > 1) {
        add(
          "control-label-wraps",
          "warning",
          `Control label wraps onto ${renderedLineCount(el)} lines.`,
          { selector, text: text.slice(0, 100), box: box(el) },
        );
      }
    }
  }

  function auditTables() {
    for (const table of [...document.querySelectorAll("table")].filter(
      isVisible,
    )) {
      const selector = describe(table);
      const rect = table.getBoundingClientRect();
      const naturalWidth = Math.max(table.scrollWidth, Math.round(rect.width));
      let scrollHost = null;
      let node = table.parentElement;
      for (let depth = 0; node && depth < 5; depth += 1) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") {
          scrollHost = node;
          break;
        }
        node = node.parentElement;
      }
      const columns = table.querySelector("tr")?.children.length || 0;
      if (naturalWidth > clientWidth + 2 && !scrollHost) {
        add(
          "table-overflows-without-scroll-container",
          "error",
          `Table needs ${naturalWidth}px inside a ${clientWidth}px viewport and no ancestor scrolls horizontally. ${columns} column(s). The responsive strategy for this table is a product decision — ask before redesigning it.`,
          { selector, box: box(table), columns },
        );
      } else if (naturalWidth > clientWidth + 2 && scrollHost && isMobile) {
        add(
          "table-scrolls-horizontally",
          "info",
          `Table (${columns} column(s), ${naturalWidth}px) scrolls inside ${describe(scrollHost)}. Verify the first column stays useful while scrolled.`,
          { selector, box: box(table), columns },
        );
      }
      if (isMobile) {
        for (const cell of [...table.querySelectorAll("td,th")]
          .filter(isVisible)
          .slice(0, 40)) {
          const cellRect = cell.getBoundingClientRect();
          if (cellRect.width < 36 && clean(cell.textContent).length > 2) {
            add(
              "table-cell-crushed",
              "warning",
              `Cell is ${Math.round(cellRect.width)}px wide with ${clean(cell.textContent).length} characters of content.`,
              {
                selector: describe(cell),
                text: clean(cell.textContent).slice(0, 60),
                box: box(cell),
              },
            );
            break;
          }
        }
      }
    }
  }

  function auditImages() {
    for (const img of [...document.querySelectorAll("img")].filter(isVisible)) {
      const selector = describe(img);
      const rect = img.getBoundingClientRect();
      if (img.complete && img.naturalWidth === 0) {
        add(
          "image-failed-to-load",
          "error",
          `Image did not load: ${(img.currentSrc || img.src || "").slice(0, 120)}`,
          { selector, box: box(img) },
        );
        continue;
      }
      const parent = img.parentElement;
      if (
        parent &&
        rect.width > parent.clientWidth + 2 &&
        parent.clientWidth > 0
      ) {
        add(
          "image-overflows-container",
          "error",
          `Image renders ${Math.round(rect.width)}px inside a ${parent.clientWidth}px container. It needs a fluid width (max-width:100%) or responsive sizing.`,
          { selector, box: box(img) },
        );
      }
      if (img.naturalWidth > 0 && rect.height > 0) {
        const naturalRatio = img.naturalWidth / img.naturalHeight;
        const renderedRatio = rect.width / rect.height;
        const objectFit = getComputedStyle(img).objectFit;
        if (
          objectFit === "fill" &&
          Math.abs(renderedRatio - naturalRatio) / naturalRatio > 0.15
        ) {
          add(
            "image-aspect-distorted",
            "warning",
            `Rendered aspect ${renderedRatio.toFixed(2)} vs natural ${naturalRatio.toFixed(2)} with object-fit:fill.`,
            { selector, box: box(img) },
          );
        }
      }
    }
  }

  function auditTouchTargets() {
    if (!isMobile) return;
    const selector = [
      "a[href]",
      "button",
      "input:not([type=hidden])",
      "select",
      "textarea",
      "summary",
      "[role=button]",
      "[role=link]",
      "[role=tab]",
      "[role=checkbox]",
      "[role=radio]",
      "[role=switch]",
      "[tabindex]:not([tabindex^='-'])",
    ].join(",");
    const targets = [...document.querySelectorAll(selector)]
      .filter(isVisible)
      .filter(
        (el) =>
          !el.matches(":disabled") &&
          el.getAttribute("aria-disabled") !== "true",
      )
      .slice(0, 300);

    const boxes = targets.map((el) => ({
      el,
      rect: el.getBoundingClientRect(),
    }));
    for (const { el, rect } of boxes) {
      const style = getComputedStyle(el);
      const inlineInProse =
        style.display.startsWith("inline") &&
        el.tagName === "A" &&
        /^(P|LI|SPAN|TD|DD|SMALL|STRONG|EM|LABEL)$/.test(
          el.parentElement?.tagName || "",
        );
      if (inlineInProse) continue;
      const shorter = Math.min(rect.width, rect.height);
      if (shorter < 24) {
        add(
          "touch-target-too-small",
          "error",
          `Interactive control renders ${Math.round(rect.width)}x${Math.round(rect.height)}px; WCAG 2.5.8 asks for 24x24 CSS px minimum.`,
          {
            selector: describe(el),
            text: clean(
              el.textContent || el.getAttribute("aria-label") || "",
            ).slice(0, 60),
            box: box(el),
          },
        );
        continue;
      }
      if (shorter < 44) {
        const crowded = boxes.some(({ el: other, rect: otherRect }) => {
          if (other === el) return false;
          const gapX = Math.max(
            0,
            Math.max(rect.left - otherRect.right, otherRect.left - rect.right),
          );
          const gapY = Math.max(
            0,
            Math.max(rect.top - otherRect.bottom, otherRect.top - rect.bottom),
          );
          return gapX < 8 && gapY < 8;
        });
        if (crowded) {
          add(
            "touch-targets-crowded",
            "warning",
            `Control is ${Math.round(rect.width)}x${Math.round(rect.height)}px with less than 8px of clear space from its neighbour.`,
            {
              selector: describe(el),
              text: clean(el.textContent || "").slice(0, 60),
              box: box(el),
            },
          );
        }
      }
    }
  }

  function auditOverlaps() {
    const candidates = visibleElements
      .filter((el) => {
        const style = getComputedStyle(el);
        if (!["static", "relative"].includes(style.position)) return false;
        if (!ownText(el)) return false;
        return el.getBoundingClientRect().top < window.innerHeight * 3;
      })
      .slice(0, 220);
    let reported = 0;
    for (let i = 0; i < candidates.length && reported < 5; i += 1) {
      const a = candidates[i];
      const rectA = a.getBoundingClientRect();
      for (let j = i + 1; j < candidates.length && reported < 5; j += 1) {
        const b = candidates[j];
        if (a.contains(b) || b.contains(a)) continue;
        const rectB = b.getBoundingClientRect();
        const overlapWidth =
          Math.min(rectA.right, rectB.right) - Math.max(rectA.left, rectB.left);
        const overlapHeight =
          Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top);
        if (overlapWidth <= 2 || overlapHeight <= 2) continue;
        const overlapArea = overlapWidth * overlapHeight;
        const smallest = Math.min(
          rectA.width * rectA.height,
          rectB.width * rectB.height,
        );
        if (smallest <= 0 || overlapArea / smallest < 0.35) continue;
        reported += 1;
        add(
          "elements-overlap",
          "warning",
          `Two statically positioned text elements overlap by ${Math.round(overlapWidth)}x${Math.round(overlapHeight)}px. Confirm on the screenshot before fixing.`,
          {
            selector: describe(a),
            text: `${ownText(a).slice(0, 40)} / ${ownText(b).slice(0, 40)}`,
            box: box(a),
            other: describe(b),
          },
        );
      }
    }
  }

  function auditStylesheetOnlyDefects() {
    let readableSheets = 0;
    let focusRules = 0;
    let outlineSuppressed = 0;
    const hoverReveals = [];
    const focusSelectors = new Set();

    const walk = (rules) => {
      for (const rule of rules) {
        const selectorText = rule.selectorText || "";
        const cssText = rule.cssText || "";
        if (selectorText) {
          if (/:focus(-visible|-within)?\b/.test(selectorText)) {
            focusRules += 1;
            focusSelectors.add(
              selectorText.replace(/:focus(-visible|-within)?/g, ":hover"),
            );
          }
          if (/outline\s*:\s*(none|0(px)?)\s*[;}]/i.test(cssText))
            outlineSuppressed += 1;
          if (
            /:hover\b/.test(selectorText) &&
            /(display|visibility|opacity)\s*:/.test(cssText)
          ) {
            hoverReveals.push(selectorText);
          }
        }
        if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        if (!sheet.cssRules) continue;
        readableSheets += 1;
        walk(sheet.cssRules);
      } catch {
        /* cross-origin sheet */
      }
    }
    if (!readableSheets) return;

    const focusables = [
      ...document.querySelectorAll(
        "a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex^='-'])",
      ),
    ].filter(isVisible);
    if (focusables.length >= 3 && outlineSuppressed > 0 && focusRules === 0) {
      add(
        "focus-indicator-suppressed",
        "error",
        `Stylesheets remove the focus outline in ${outlineSuppressed} rule(s) and define no :focus/:focus-visible replacement.`,
        { selector: ":root" },
      );
    }
    if (isMobile) {
      const unmatched = hoverReveals
        .filter((selectorText) => !focusSelectors.has(selectorText))
        .slice(0, 3);
      if (unmatched.length) {
        add(
          "hover-only-reveal",
          "warning",
          `${unmatched.length} rule(s) reveal content on :hover with no :focus/:focus-within equivalent, so touch users may never see it. Example: ${unmatched[0].slice(0, 120)}`,
          { selector: ":root" },
        );
      }
    }
  }
}

async function waitForReadiness(page, selector, delayMs) {
  if (selector) {
    await page
      .waitForSelector(selector, { state: "visible", timeout: 15_000 })
      .catch(() => {});
  }
  await page
    .evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    })
    .catch(() => {});
  if (delayMs > 0) await page.waitForTimeout(delayMs);
}

function issueKey(issue) {
  return [
    issue.route,
    issue.viewport,
    issue.type,
    issue.selector || "",
    (issue.text || "").slice(0, 40),
  ].join("|");
}

function diffAgainstBaseline(current, baselineFile) {
  const previous = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  const previousKeys = new Map(
    (previous.issues || []).map((issue) => [issueKey(issue), issue]),
  );
  const currentKeys = new Map(current.map((issue) => [issueKey(issue), issue]));
  const introduced = [...currentKeys.entries()]
    .filter(([key]) => !previousKeys.has(key))
    .map(([, issue]) => issue);
  const resolved = [...previousKeys.entries()]
    .filter(([key]) => !currentKeys.has(key))
    .map(([, issue]) => issue);
  return {
    baseline: baselineFile,
    introduced,
    resolved,
    persisting: current.length - introduced.length,
  };
}

const { chromium } = loadPlaywright();
const explicitChrome = argValue("--chrome") || process.env.CHROME_PATH || null;

let browser;
try {
  browser = await chromium.launch(
    explicitChrome
      ? { executablePath: explicitChrome, headless: true }
      : { headless: true },
  );
} catch (error) {
  const systemChrome = findSystemChrome();
  if (!systemChrome)
    fail(
      `Could not launch Chromium: ${error.message}\nInstall Playwright browsers or pass --chrome <path>.`,
      2,
    );
  browser = await chromium.launch({
    executablePath: systemChrome,
    headless: true,
  });
}

const report = {
  tool: "responsive-mobile-qa/responsive_audit",
  createdAt: new Date().toISOString(),
  baseUrl: origin.origin,
  routes,
  viewports: viewports.map(({ name, width, height }) => ({
    name,
    width,
    height,
  })),
  outDir,
  checked: [
    "document and element horizontal overflow with the offending element identified",
    "clipped and truncated text",
    "font sizes and heading scale on mobile viewports",
    "table width strategy and crushed cells",
    "image loading, container fit, and aspect distortion",
    "touch target size and spacing on mobile/tablet viewports",
    "statically positioned text overlaps",
    "viewport meta, zoom restrictions, and effective viewport",
    "focus-outline suppression and hover-only reveals",
    "console errors and failed requests per route",
  ],
  notChecked: [
    "keyboard journeys and focus order",
    "real-device behavior (this is Chromium emulation)",
    "interactive states behind clicks (open menus, modals, validation)",
    "full WCAG conformance",
    "subjective visual quality — read the screenshots for that",
  ],
  pages: [],
  issues: [],
};

let hardFailures = 0;

for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    ...(storageStatePath ? { storageState: storageStatePath } : {}),
  });
  const page = await context.newPage();

  for (const route of routes) {
    const targetUrl = new URL(route, origin).toString();
    const consoleErrors = [];
    const failedRequests = [];
    const onConsole = (message) => {
      if (message.type() === "error")
        consoleErrors.push(message.text().slice(0, 300));
    };
    const onRequestFailed = (request) => {
      failedRequests.push(
        `${request.method()} ${request.url().slice(0, 200)} — ${request.failure()?.errorText || "failed"}`,
      );
    };
    page.on("console", onConsole);
    page.on("requestfailed", onRequestFailed);

    const record = {
      route,
      viewport: viewport.name,
      requestedUrl: targetUrl,
      finalUrl: null,
      httpStatus: null,
      screenshot: null,
      fullPageScreenshot: null,
      meta: null,
      consoleErrors: [],
      failedRequests: [],
    };

    try {
      const response = await page.goto(targetUrl, {
        waitUntil,
        timeout: 45_000,
      });
      record.httpStatus = response?.status() ?? null;
      record.finalUrl = page.url();
      if (record.httpStatus !== null && record.httpStatus >= 400) {
        report.issues.push({
          route,
          viewport: viewport.name,
          type: "route-http-error",
          severity: "error",
          detail: `${targetUrl} returned HTTP ${record.httpStatus}.`,
        });
        hardFailures += 1;
      } else {
        await waitForReadiness(page, readySelector, settleMs);
        await page.evaluate(() => window.scrollTo(0, 0));
        const result = await page.evaluate(auditRenderedPage, {
          viewportName: viewport.name,
          requestedWidth: viewport.width,
          isMobile: viewport.isMobile,
        });
        record.meta = result.meta;
        const routeIssues = result.issues.map((issue) => ({ route, ...issue }));
        report.issues.push(...routeIssues);
        const wantsShot =
          screenshotMode === "always" ||
          (screenshotMode === "issues" &&
            routeIssues.some((issue) => issue.severity !== "info"));
        if (wantsShot) {
          const base = `${slug(route)}__${viewport.name}`;
          record.screenshot = path.join(outDir, `${base}.png`);
          await page.screenshot({ path: record.screenshot, fullPage: false });
          if (fullPage) {
            record.fullPageScreenshot = path.join(outDir, `${base}__full.png`);
            await page.screenshot({
              path: record.fullPageScreenshot,
              fullPage: true,
            });
          }
        }
      }
    } catch (error) {
      report.issues.push({
        route,
        viewport: viewport.name,
        type: "route-navigation-failed",
        severity: "error",
        detail: `${targetUrl}: ${String(error.message).split("\n")[0]}`,
      });
      hardFailures += 1;
    } finally {
      page.off("console", onConsole);
      page.off("requestfailed", onRequestFailed);
    }

    record.consoleErrors = consoleErrors.slice(0, 5);
    record.failedRequests = failedRequests.slice(0, 5);
    if (record.consoleErrors.length) {
      report.issues.push({
        route,
        viewport: viewport.name,
        type: "console-error",
        severity: "warning",
        detail: `${consoleErrors.length} console error(s). First: ${record.consoleErrors[0]}`,
      });
    }
    if (record.failedRequests.length) {
      report.issues.push({
        route,
        viewport: viewport.name,
        type: "request-failed",
        severity: "warning",
        detail: `${failedRequests.length} failed request(s). First: ${record.failedRequests[0]}`,
      });
    }
    report.pages.push(record);
  }

  await context.close();
}

await browser.close();

const counts = { error: 0, warning: 0, info: 0 };
const byType = {};
for (const issue of report.issues) {
  counts[issue.severity] = (counts[issue.severity] || 0) + 1;
  byType[issue.type] = (byType[issue.type] || 0) + 1;
}
report.summary = {
  routes: routes.length,
  viewports: viewports.length,
  pageRuns: report.pages.length,
  errors: counts.error,
  warnings: counts.warning,
  info: counts.info,
  byType,
};
if (baselinePath)
  report.baselineDiff = diffAgainstBaseline(report.issues, baselinePath);

const reportPath = path.join(outDir, "report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

if (!quiet) {
  const worst = report.issues
    .filter((issue) => issue.severity === "error")
    .slice(0, 25);
  for (const issue of worst) {
    console.log(`ERROR  ${issue.route} @ ${issue.viewport}  ${issue.type}`);
    console.log(`       ${issue.detail}`);
    if (issue.selector) console.log(`       at ${issue.selector}`);
  }
}
console.log(
  `\n${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.info} info ` +
    `across ${report.summary.routes} route(s) x ${report.summary.viewports} viewport(s).`,
);
const topTypes = Object.entries(byType)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12);
for (const [type, count] of topTypes)
  console.log(`  ${String(count).padStart(4)}  ${type}`);
if (report.baselineDiff) {
  console.log(
    `\nBaseline diff vs ${report.baselineDiff.baseline}: ` +
      `${report.baselineDiff.introduced.length} new, ${report.baselineDiff.resolved.length} resolved, ${report.baselineDiff.persisting} persisting.`,
  );
  for (const issue of report.baselineDiff.introduced.slice(0, 15)) {
    console.log(
      `  NEW  ${issue.severity} ${issue.route} @ ${issue.viewport} ${issue.type} ${issue.selector || ""}`,
    );
  }
}
console.log(`\nEvidence: ${outDir}\nReport:   ${reportPath}`);
console.log(
  "Open the screenshots. A page with zero mechanical findings is not automatically a good mobile layout.",
);

if (failOn === "never") process.exit(0);
if (report.summary.errors > 0 || hardFailures > 0) process.exit(1);
if (failOn === "warning" && report.summary.warnings > 0) process.exit(1);
process.exit(0);
