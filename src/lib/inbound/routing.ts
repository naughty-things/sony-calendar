export type EmailPostRoute = {
  publishDate: string | null;
  status: 'staging' | 'in_progress' | 'client_review';
  reason: string;
};

type EmailPostRoutingInput = {
  publish_date?: string | null;
  target_launch_date?: string | null;
  title?: string | null;
  confidence?: number | null;
  parse_warnings?: string[] | null;
};

/**
 * Put dated email tasks on the calendar while keeping ambiguous, incomplete
 * work in a reviewable status. Only a missing concrete launch date stays in
 * the undated staging queue.
 */
export function routeEmailPost(item: EmailPostRoutingInput): EmailPostRoute {
  const publishDate = item.publish_date || item.target_launch_date || null;
  const hasTitle = !!item.title?.trim();
  const confidence = typeof item.confidence === 'number' ? item.confidence : 0.5;
  const warnings = Array.isArray(item.parse_warnings) ? item.parse_warnings : [];

  if (!publishDate) {
    return {
      publishDate: null,
      status: 'staging',
      reason: 'no concrete target launch date; staff must assign a date'
    };
  }

  if (hasTitle && confidence >= 0.7 && warnings.length === 0) {
    return {
      publishDate,
      status: 'client_review',
      reason: 'clear launch date and complete high-confidence brief'
    };
  }

  return {
    publishDate,
    status: 'in_progress',
    reason: !hasTitle
      ? 'launch date found but title needs staff review'
      : warnings.length > 0
      ? `launch date found with ${warnings.length} parse warning(s); placed on calendar for review`
      : `launch date found with lower confidence (${confidence}); placed on calendar for review`
  };
}
