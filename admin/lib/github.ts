export async function triggerWorkflow(workflowFile: string): Promise<void> {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!repo || !token) {
    throw new Error("GITHUB_REPO 또는 GITHUB_TOKEN 환경변수가 설정되지 않았습니다.");
  }

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API error: ${res.status} ${body}`);
  }
}
