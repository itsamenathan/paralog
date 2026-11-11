const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ImmichAsset = {
  id?: string;
  width?: number | null;
  height?: number | null;
  localDateTime?: string;
  fileCreatedAt?: string;
};

type ImmichSearchResponse = {
  assets?: {
    items?: ImmichAsset[];
    total?: number;
    nextPage?: string | null;
  };
};

export type ImmichPhoto = {
  id: string;
  width: number | null;
  height: number | null;
  capturedAt: string | null;
};

export type ImmichImageSize = 'thumbnail' | 'preview';

function config() {
  const rawUrl = process.env.IMMICH_API_URL?.trim();
  const apiKey = process.env.IMMICH_API_KEY?.trim();
  if (!rawUrl || !apiKey) return null;
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Immich URL must use HTTP or HTTPS.');
  url.pathname = `${url.pathname.replace(/\/$/, '')}${url.pathname.replace(/\/$/, '').endsWith('/api') ? '' : '/api'}`;
  url.search = '';
  url.hash = '';
  return { baseUrl: url.toString().replace(/\/$/, ''), apiKey };
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (!DATE_PATTERN.test(date) || Number.isNaN(value.valueOf()) || value.toISOString().slice(0, 10) !== date) return null;
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function request(path: string, init?: RequestInit) {
  const current = config();
  if (!current) throw new Error('Immich is not configured.');
  return fetch(`${current.baseUrl}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { ...init?.headers, 'x-api-key': current.apiKey },
    signal: AbortSignal.timeout(12_000),
  });
}

export function immichConfigured() {
  return Boolean(process.env.IMMICH_API_URL?.trim() && process.env.IMMICH_API_KEY?.trim());
}

export async function photosForDate(date: string) {
  const searchStart = shiftDate(date, -1);
  const searchEnd = shiftDate(date, 2);
  if (!searchStart || !searchEnd) throw new Error('A valid date is required.');

  // Immich filters `takenAfter`/`takenBefore` using the absolute capture instant,
  // but groups its timeline by the timezone-agnostic `localDateTime`. Search a
  // padded window, then select the same local calendar date Immich displays.
  const assets: ImmichAsset[] = [];
  let page = 1;
  for (let requestCount = 0; requestCount < 20; requestCount += 1) {
    const response = await request('/search/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        takenAfter: `${searchStart}T00:00:00.000Z`,
        takenBefore: `${searchEnd}T00:00:00.000Z`,
        type: 'IMAGE',
        order: 'asc',
        page,
        size: 250,
        withExif: false,
        withPeople: false,
        withStacked: true,
      }),
    });
    if (!response.ok) throw new Error(`Immich search failed with status ${response.status}.`);
    const result = await response.json() as ImmichSearchResponse;
    assets.push(...(result.assets?.items || []));
    const nextPage = Number.parseInt(result.assets?.nextPage || '', 10);
    if (!Number.isInteger(nextPage) || nextPage <= page) break;
    page = nextPage;
  }

  const matching = assets.filter((asset) => (asset.localDateTime || asset.fileCreatedAt || '').slice(0, 10) === date);
  const photos: ImmichPhoto[] = matching
    .filter((asset): asset is ImmichAsset & { id: string } => typeof asset.id === 'string' && ASSET_ID_PATTERN.test(asset.id))
    .map((asset) => ({
      id: asset.id,
      width: typeof asset.width === 'number' ? asset.width : null,
      height: typeof asset.height === 'number' ? asset.height : null,
      capturedAt: asset.localDateTime || asset.fileCreatedAt || null,
    }));
  return { photos, total: matching.length };
}

export async function photoPreview(id: string, size: ImmichImageSize = 'preview') {
  if (!ASSET_ID_PATTERN.test(id)) return null;
  const response = await request(`/assets/${encodeURIComponent(id)}/thumbnail?size=${size}`);
  if (!response.ok) return null;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) return null;
  return { bytes: await response.arrayBuffer(), contentType };
}

export type ImmichYearPhotos = {
  date: string;
  total: number;
  photos: ImmichPhoto[];
};

const ON_THIS_DAY_CONCURRENCY = 4;
const ON_THIS_DAY_CACHE_MS = 10 * 60_000;
const onThisDayCache = new Map<string, { expires: number; result: Promise<{ years: ImmichYearPhotos[]; total: number }> }>();

type ImmichTimeBucket = { timeBucket?: string; count?: number };

// Years before `year` that hold photos in `month` (`MM`), read from the month
// buckets Immich builds for its timeline. Needs the `timeline.read` permission.
async function yearsWithPhotosInMonth(month: string, year: number) {
  const response = await request('/timeline/buckets');
  if (!response.ok) throw new Error(`Immich timeline failed with status ${response.status}.`);
  const buckets = await response.json() as ImmichTimeBucket[];
  const years = new Set<number>();
  for (const bucket of Array.isArray(buckets) ? buckets : []) {
    const match = /^(\d{4})-(\d{2})/.exec(bucket.timeBucket || '');
    if (!match || match[2] !== month || !bucket.count) continue;
    if (Number(match[1]) < year) years.add(Number(match[1]));
  }
  return [...years];
}

async function loadPhotosOnThisDay(date: string) {
  const [yearText, month, day] = date.split('-');
  const year = Number(yearText);
  const candidates = await yearsWithPhotosInMonth(month, year);
  // February 29 only exists in leap years; shiftDate rejects it elsewhere.
  const dates = candidates
    .sort((left, right) => right - left)
    .map((candidate) => `${String(candidate).padStart(4, '0')}-${month}-${day}`)
    .filter((candidate) => shiftDate(candidate, 0) === candidate);

  const years: ImmichYearPhotos[] = [];
  for (let index = 0; index < dates.length; index += ON_THIS_DAY_CONCURRENCY) {
    const batch = dates.slice(index, index + ON_THIS_DAY_CONCURRENCY);
    const results = await Promise.all(batch.map(async (candidate) => ({ date: candidate, ...await photosForDate(candidate) })));
    years.push(...results.filter((result) => result.photos.length > 0));
  }
  return { years, total: years.reduce((sum, item) => sum + item.total, 0) };
}

export function photosOnThisDay(date: string) {
  if (!DATE_PATTERN.test(date) || shiftDate(date, 0) !== date) throw new Error('A valid date is required.');
  const now = Date.now();
  for (const [key, cached] of onThisDayCache) if (cached.expires <= now) onThisDayCache.delete(key);
  const cached = onThisDayCache.get(date);
  if (cached) return cached.result;
  const result = loadPhotosOnThisDay(date);
  onThisDayCache.set(date, { expires: now + ON_THIS_DAY_CACHE_MS, result });
  result.catch(() => onThisDayCache.delete(date));
  return result;
}
