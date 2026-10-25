// This is an example app policy, not a guarantee that media is safe.
export const CHECKS = ['sexual', 'violence', 'dangerous'];
export function decide(report) {
  const held = reason => ({state: 'held', reason});
  if (!report || report.ok !== true || report.error) return held('Analysis missing or unsuccessful; keep private.');
  if (report.mode !== 'report' && report.mode !== 'block') return held('Unknown moderation mode.');
  if (!CHECKS.every(check => report.requestedChecks?.includes(check))) return held('Required checks were not requested.');
  if (!['allow', 'review', 'block'].includes(report.verdict)) return held('Unknown verdict; keep private.');
  if (report.verdict === 'block') return {state: 'rejected', reason: 'Provider block verdict; do not publish.'};
  if (report.verdict === 'review') return held('Provider requests contextual human review.');
  if (!CHECKS.every(check => report.checks?.some(row => row.check === check && row.decision === 'allow'))
      || report.checks?.some(row => row.decision !== 'allow')
      || report.flaggedChecks?.length || report.judge?.ok === false)
    return held('Incomplete or conflicting checks; review before publishing.');
  return {state: 'eligible', reason: 'Requested checks allow. A reviewer must still approve this demo upload.'};
}
