export function parseRouteId(param: string | string[]): number | null {
  const id = parseInt(String(param));
  return (!isNaN(id) && id > 0) ? id : null;
}
