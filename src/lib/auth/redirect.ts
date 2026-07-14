const LOCAL_ORIGIN = 'https://sony-calendar.invalid';

/** Return a normalized same-origin application path, or `/` when unsafe. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || /[\\\u0000-\u001f\u007f]/.test(value)) return '/';

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return '/';
  }

  if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.includes('\\')) {
    return '/';
  }

  try {
    const url = new URL(decoded, LOCAL_ORIGIN);
    if (url.origin !== LOCAL_ORIGIN) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
