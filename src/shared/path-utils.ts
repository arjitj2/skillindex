export function joinPath(...segments: string[]): string {
  const normalizedSegments = segments
    .filter((segment) => segment.length > 0)
    .map((segment, index) => normalizePathSegment(segment, index === 0));

  if (normalizedSegments.length === 0) {
    return '';
  }

  if (normalizedSegments[0] === '/') {
    const remainingSegments = normalizedSegments.slice(1);
    return remainingSegments.length > 0 ? `/${remainingSegments.join('/')}` : '/';
  }

  return normalizedSegments.join('/') || '/';
}

function normalizePathSegment(segment: string, preserveLeadingSlash: boolean): string {
  const withForwardSlashes = segment.replace(/\\/g, '/');

  if (preserveLeadingSlash) {
    const trimmedTrailing = withForwardSlashes.replace(/\/+$/g, '');
    return trimmedTrailing === '' ? '/' : trimmedTrailing;
  }

  return withForwardSlashes.replace(/^\/+/g, '').replace(/\/+$/g, '');
}
