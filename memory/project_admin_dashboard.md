---
name: Admin Dashboard Plan
description: Internal admin dashboard planned after crawler is complete
type: project
---

After the gear crawler is implemented, build an internal admin dashboard with:
- Crawl job status and history view
- needs_review product queue (review/edit/approve flagged products)
- Product data editing interface
- Basic stats (total products, by category, recent crawls)

**Why:** User requested this after crawler brainstorming session on 2026-03-23.
**How to apply:** Plan this as a separate project after crawler tasks are complete. Stack will likely be Next.js or similar, reading from the same Supabase DB.
