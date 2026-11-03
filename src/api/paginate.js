// Descarga las páginas 2..totalPages en paralelo (por tandas) y las devuelve en orden de página.
export async function fetchPagesParallel(totalPages, fetchPage, concurrency = 6) {
  const results = [];
  for (let start = 2; start <= totalPages; start += concurrency) {
    const nums = [];
    for (let p = start; p < start + concurrency && p <= totalPages; p++) nums.push(p);
    results.push(...await Promise.all(nums.map(fetchPage)));
  }
  return results;
}
