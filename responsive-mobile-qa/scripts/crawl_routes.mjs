#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { createRequire } from "node:module";

const USAGE = [
  "Usage: crawl_routes.mjs --base-url <http://localhost:3000> [options]",
  "",
  "  --seed <path>            Starting route; repeatable. Default: /",
  "  --max-pages <n>          Stop after visiting n pages (default 40).",
  "  --max-depth <n>          Link depth from the seeds (default 3).",
  "  --exclude <regex>        Skip matching paths; repeatable (logout, delete, ...).",
  "  --storage-state <file>   Playwright storageState JSON for an authenticated crawl.",
  "  --settle-ms <n>          Settle time after load (default 400).",
  "  --out <file>             Write the discovered routes (one per line).",
  "",
  "Prints every same-origin route reachable by following rendered links.",
  "It cannot see routes that are only reachable through a form post, a redirect,",
  "or a role you are not signed in as — enumerate those from the router source.",
].join("\n");

function fail(message, code = 2) {
  if (message) console.error(message);
  console.error(USAGE);
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

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

function loadPlaywright() {
  const requirers = [
    createRequire(`${process.cwd()}/package.json`),
    createRequire(import.meta.url),
  ];
  for (const requireFrom of requirers) {
    for (const name of ["@playwright/test", "playwright", "playwright-core"]) {
      try {
        const mod = requireFrom(name);
        if (mod?.chromium) return mod;
      } catch {
        /* keep looking */
      }
    }
  }
  fail("No Playwright driver found in this project.");
}

const baseUrl = argValue("--base-url");
if (!baseUrl) fail("--base-url is required.");
const origin = new URL(baseUrl);
const seeds = argValues("--seed");
const maxPages = Number(argValue("--max-pages", "40"));
const maxDepth = Number(argValue("--max-depth", "3"));
const settleMs = Number(argValue("--settle-ms", "400"));
const storageStatePath = argValue("--storage-state");
const outFile = argValue("--out");
const excludes = argValues("--exclude").map(
  (pattern) => new RegExp(pattern, "i"),
);
const defaultExcludes = [/\/(logout|signout|sign-out)(\/|$)/i, /\/api\//i];

function skip(pathname) {
  return [...excludes, ...defaultExcludes].some((pattern) =>
    pattern.test(pathname),
  );
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  ...(storageStatePath ? { storageState: storageStatePath } : {}),
});
const page = await context.newPage();

const queue = (seeds.length ? seeds : ["/"]).map((route) => ({
  route,
  depth: 0,
}));
const seen = new Set(queue.map((item) => item.route));
const discovered = [];

while (queue.length && discovered.length < maxPages) {
  const { route, depth } = queue.shift();
  const url = new URL(route, origin).toString();
  let status = null;
  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    status = response?.status() ?? null;
    await page.waitForTimeout(settleMs);
  } catch (error) {
    discovered.push({
      route,
      status: "error",
      note: String(error.message).split("\n")[0],
    });
    continue;
  }
  const finalPath = new URL(page.url()).pathname;
  const redirected = finalPath !== new URL(url).pathname;
  discovered.push({
    route,
    status,
    finalPath,
    redirected: redirected || undefined,
  });

  if (depth >= maxDepth) continue;
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll("a[href]")].map((a) => a.href),
  );
  for (const href of hrefs) {
    let parsed;
    try {
      parsed = new URL(href);
    } catch {
      continue;
    }
    if (parsed.origin !== origin.origin) continue;
    const next = parsed.pathname + parsed.search;
    if (seen.has(next) || skip(next)) continue;
    seen.add(next);
    queue.push({ route: next, depth: depth + 1 });
  }
}

await browser.close();

const routes = discovered.map((item) => item.route);
for (const item of discovered) {
  const flags = [
    item.status,
    item.redirected ? `-> ${item.finalPath}` : "",
    item.note || "",
  ]
    .filter(Boolean)
    .join(" ");
  console.log(`${item.route}\t${flags}`);
}
console.log(
  `\n${routes.length} route(s) reached${queue.length ? `, ${queue.length} left unvisited (raise --max-pages)` : ""}.`,
);
if (outFile) {
  fs.writeFileSync(outFile, `${routes.join("\n")}\n`);
  console.log(`Wrote ${outFile}`);
}
