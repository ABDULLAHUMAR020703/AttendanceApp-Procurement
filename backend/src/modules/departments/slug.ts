/** Produce a stable departments.code from a human-readable name. */
export function slugifyDepartmentCode(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 48);
  return base.length > 0 ? base : 'department';
}
