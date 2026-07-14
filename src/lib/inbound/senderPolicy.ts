const DEFAULT_ALLOWED_DOMAINS = ['naughtythings.com.hk'];

export function allowedInboundDomains(value = process.env.INBOUND_ALLOWED_DOMAINS): string[] {
  const configured = value
    ?.split(',')
    .map(domain => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return configured && configured.length > 0 ? configured : DEFAULT_ALLOWED_DOMAINS;
}

export function isTrustedEnvelopeSender(
  fromHeader: string,
  domains = allowedInboundDomains()
): boolean {
  const angleAddress = fromHeader.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/)?.[1];
  const bareAddress = fromHeader.match(/(?:^|\s)([^<>\s]+@[^<>\s]+)(?:\s|$)/)?.[1];
  const address = (angleAddress || bareAddress || fromHeader).trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) return false;
  const domain = address.slice(at + 1).replace(/[>,;]+$/, '');
  return domains.some(allowed => domain === allowed || domain.endsWith(`.${allowed}`));
}
