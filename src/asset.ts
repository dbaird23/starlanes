/**
 * Prefix a public-asset path with Vite's base URL.
 * On GitHub Pages that is `/starlanes/`; locally it is `/`.
 */
export function asset(path: string): string {
  const base = import.meta.env.BASE_URL;
  const clean = path.startsWith("/") ? path.slice(1) : path;
  return `${base}${clean}`;
}
