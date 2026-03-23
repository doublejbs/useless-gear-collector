import { chromium } from "playwright";
import { parseRobotsTxt } from "../utils/robots.js";
import type { RawProduct } from "./types.js";

const USER_AGENT = "GearCollectorBot/1.0";
const MIN_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5_000;
const MAX_RETRIES = 3;

function randomDelay(): Promise<void> {
  const ms = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchPageHtml(
  url: string,
  retries = 0
): Promise<string | null> {
  const allowed = await isAllowedByRobots(url);
  if (!allowed) return null;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await randomDelay();
    return await page.content();
  } catch (err) {
    if (retries < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 2 ** (retries + 1) * 1_000));
      return fetchPageHtml(url, retries + 1);
    }
    return null;
  } finally {
    await browser.close();
  }
}

async function isAllowedByRobots(url: string): Promise<boolean> {
  try {
    const { origin, pathname } = new URL(url);
    const robotsUrl = `${origin}/robots.txt`;
    const res = await fetch(robotsUrl);
    if (!res.ok) return true;
    const text = await res.text();
    return parseRobotsTxt(text, USER_AGENT, pathname);
  } catch {
    return true;
  }
}
