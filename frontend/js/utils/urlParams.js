// Read a URL parameter from either the query string (?name=value) or the hash
// (#name=value). We prefer the hash for internal links because some static
// servers (e.g. Live Server / `serve` "clean URLs") drop the query string when
// they redirect `page.html` -> `page`, which would lose the id/token.

export function readParam(name) {
  const fromQuery = new URLSearchParams(window.location.search).get(name);
  if (fromQuery) return fromQuery;

  const hash = window.location.hash.replace(/^#/, '');
  const fromHash = new URLSearchParams(hash).get(name);
  return fromHash || null;
}

// Build an internal link that survives clean-URL redirects.
export function withHashParam(page, name, value) {
  return `${page}#${name}=${encodeURIComponent(value)}`;
}
