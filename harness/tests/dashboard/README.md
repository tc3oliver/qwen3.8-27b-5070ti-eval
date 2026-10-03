# Validating the dashboard grader

`ref/` is a reference solution of `data/agent_tasks/dashboard/TASK.md`; `bad/` is a copy with six deliberate
defects (hard-coded KPI, non-proportional bars, sorting disabled, empty cells as 0, theme not persisted, page wider
than a 375 px phone). To check the grader, copy `data/agent_tasks/dashboard/data/` next to each and run
`harness/grade_dashboard.py`. Results with the current grader: reference 20/20, broken copy 13/20 (`grades/`).
Every injected defect is caught. Known gap: a mild length distortion between two near-equal values (33 vs 32) stays
inside the 3 % proportionality tolerance.

History: the first grader passed the reference 18/18 and the broken copy 12/18. Six leniencies found while building
the reference (a vacuous proportionality check for a single bar, no test of empty-cell sort order, a page-wide `—`
search, substring matching in the tooltip, no console listener on the mobile page, page-wide evidence-label search)
were tightened before grading again. The Pi run (`results/qwen38-27b-iq3s/pi-2026-10/dashboard-r1/`) scores 19/19
with the earlier grader (`grade-v2/`) and 20/20 with the current one (`grade-v3/`).
