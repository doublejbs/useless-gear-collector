/** robots.txt 텍스트를 파싱해 해당 경로의 크롤링 허용 여부를 반환한다. */
export function parseRobotsTxt(
  robotsTxt: string,
  userAgent: string,
  path: string
): boolean {
  const lines = robotsTxt.split("\n").map((l) => l.trim());
  let applicable = false;
  for (const line of lines) {
    if (line.toLowerCase().startsWith("user-agent:")) {
      const agent = line.split(":")[1]?.trim() ?? "";
      applicable = agent === "*" || agent.toLowerCase() === userAgent.toLowerCase();
    }
    if (!applicable) continue;
    if (line.toLowerCase().startsWith("disallow:")) {
      const disallowed = line.split(":")[1]?.trim() ?? "";
      if (disallowed && path.startsWith(disallowed)) return false;
    }
  }
  return true;
}
