// Vegetation detection using ExG (Excess Green) index from satellite tile pixels
// ExG = 2*G - R - B, threshold > 20 indicates vegetation

const TILE_SIZE = 256;

export interface VegResult {
  polygons: number[][][]; // GeoJSON Polygon coordinate rings [lng, lat][]
  coverage: number; // % of tile that's vegetation
}

/** Download a satellite tile and detect vegetation regions */
export async function detectVegetation(
  tileUrl: string,
  bounds: { west: number; south: number; east: number; north: number },
): Promise<VegResult> {
  // Fetch the tile image
  const img = await loadImage(tileUrl);
  const canvas = document.createElement('canvas');
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  const pixels = imageData.data;

  // Step 1: Build vegetation mask using ExG
  const mask = new Uint8Array(TILE_SIZE * TILE_SIZE);
  let vegCount = 0;

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const i = (y * TILE_SIZE + x) * 4;
      const R = pixels[i];
      const G = pixels[i + 1];
      const B = pixels[i + 2];
      const exg = 2 * G - R - B;
      if (exg > 25) { // Vegetation threshold
        mask[y * TILE_SIZE + x] = 1;
        vegCount++;
      }
    }
  }

  const coverage = (vegCount / (TILE_SIZE * TILE_SIZE)) * 100;

  // Step 2: Find connected components (flood fill)
  const visited = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const components: { points: [number, number][]; size: number }[] = [];

  const directions = [[0,1],[1,0],[0,-1],[-1,0],[-1,-1],[1,-1],[-1,1],[1,1]];

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const idx = y * TILE_SIZE + x;
      if (mask[idx] === 0 || visited[idx] === 1) continue;

      // Flood fill
      const queue: [number, number][] = [[x, y]];
      const points: [number, number][] = [];
      visited[idx] = 1;

      while (queue.length > 0) {
        const [cx, cy] = queue.pop()!;
        points.push([cx, cy]);

        for (const [dx, dy] of directions) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= TILE_SIZE || ny >= TILE_SIZE) continue;
          const nidx = ny * TILE_SIZE + nx;
          if (mask[nidx] === 0 || visited[nidx] === 1) continue;
          visited[nidx] = 1;
          queue.push([nx, ny]);
        }
      }

      // Filter tiny components (noise)
      if (points.length > 40) {
        components.push({ points, size: points.length });
      }
    }
  }

  // Step 3: Convert largest components to GeoJSON polygons
  // Sort by size, take top 20
  components.sort((a, b) => b.size - a.size);
  const topComponents = components.slice(0, 20);

  const polygons = topComponents.map((comp) => {
    // Compute convex hull (simplified) or just trace boundary
    const boundary = traceBoundary(comp.points, TILE_SIZE);
    // Convert pixel coords to lng/lat
    const lngSpan = bounds.east - bounds.west;
    const latSpan = bounds.north - bounds.south;
    return boundary.map(([px, py]) => {
      const lng = bounds.west + (px / TILE_SIZE) * lngSpan;
      const lat = bounds.north - (py / TILE_SIZE) * latSpan;
      return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
    });
  });

  return { polygons, coverage: Number(coverage.toFixed(1)) };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Tile load failed'));
    img.src = url;
  });
}

/** Simple boundary tracing: find min/max convex hull of points */
function traceBoundary(points: [number, number][], size: number): [number, number][] {
  // Build a binary grid for the component
  const grid = new Uint8Array(size * size);
  let minX = size, maxX = 0, minY = size, maxY = 0;
  for (const [x, y] of points) {
    grid[y * size + x] = 1;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Scanline approach: find leftmost & rightmost veg pixel per row, build a polygon ring
  const ring: [number, number][] = [];
  const step = Math.max(1, Math.floor((maxY - minY) / 30));

  // Top edge (left to right)
  for (let y = minY; y <= maxY; y += step) {
    let leftX = -1;
    for (let x = minX; x <= maxX; x++) {
      if (grid[y * size + x] === 1) { leftX = x; break; }
    }
    if (leftX >= 0) ring.push([leftX, y]);
  }
  // Right edge (top to bottom)
  for (let y = maxY; y >= minY; y -= step) {
    let rightX = -1;
    for (let x = maxX; x >= minX; x--) {
      if (grid[y * size + x] === 1) { rightX = x; break; }
    }
    if (rightX >= 0) ring.push([rightX, y]);
  }
  // Close ring
  if (ring.length > 0) ring.push(ring[0]);

  // Simplify using Douglas-Peucker
  return simplifyRing(ring, 3);
}

function simplifyRing(ring: [number, number][], tolerance: number): [number, number][] {
  if (ring.length <= 4) return ring;
  // Simple radial distance simplification
  const result: [number, number][] = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    const [px, py] = ring[i];
    const [lx, ly] = result[result.length - 1];
    const dist = Math.sqrt((px - lx) ** 2 + (py - ly) ** 2);
    if (dist >= tolerance) result.push(ring[i]);
  }
  result.push(ring[ring.length - 1]);
  return result;
}
