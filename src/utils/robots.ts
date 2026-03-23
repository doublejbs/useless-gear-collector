/** robots.txt テキストを解析して指定パスのクロールが許可されているかを返す */
export function parseRobotsTxt(
  robotsTxt: string,
  userAgent: string,
  path: string
): boolean {
  const agentName = userAgent.split("/")[0].toLowerCase();
  const lines = robotsTxt.split("\n").map((l) => l.trim());

  // Parse all rule blocks
  type RuleBlock = { agents: string[]; disallow: string[]; allow: string[] };
  const blocks: RuleBlock[] = [];
  let current: RuleBlock | null = null;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("user-agent:")) {
      const agent = line.split(":")[1]?.trim() ?? "";
      if (!current) {
        current = { agents: [agent.toLowerCase()], disallow: [], allow: [] };
      } else if (current.disallow.length === 0 && current.allow.length === 0) {
        // Consecutive user-agent lines
        current.agents.push(agent.toLowerCase());
      } else {
        blocks.push(current);
        current = { agents: [agent.toLowerCase()], disallow: [], allow: [] };
      }
    } else if (lower.startsWith("disallow:") && current) {
      const p = line.split(":")[1]?.trim() ?? "";
      if (p) current.disallow.push(p);
    } else if (lower.startsWith("allow:") && current) {
      const p = line.split(":")[1]?.trim() ?? "";
      if (p) current.allow.push(p);
    } else if (line === "" && current) {
      blocks.push(current);
      current = null;
    }
  }
  if (current) blocks.push(current);

  // Find applicable blocks (specific agent first, then wildcard)
  const specific = blocks.filter((b) => b.agents.includes(agentName));
  const wildcard = blocks.filter((b) => b.agents.includes("*"));
  const applicable = specific.length > 0 ? specific : wildcard;

  for (const block of applicable) {
    // Allow takes precedence over Disallow for more specific paths
    const allowed = block.allow.some((a) => path.startsWith(a));
    const disallowed = block.disallow.some((d) => path.startsWith(d));
    if (allowed) return true;
    if (disallowed) return false;
  }

  return true;
}
