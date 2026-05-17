export interface RadioStation {
  id: string;
  name: string;
  streamUrl: string;
  favicon?: string;
  country?: string;
  tags?: string[];
  codec?: string;
  bitrate?: number;
  homepage?: string;
  source?: 'featured' | 'search' | 'favorite' | 'restored';
}

interface RadioBrowserStation {
  stationuuid: string;
  name: string;
  url_resolved: string;
  favicon?: string;
  country?: string;
  tags?: string;
  codec?: string;
  bitrate?: number;
  homepage?: string;
}

const API_BASE = 'https://de1.api.radio-browser.info/json';

function isPlayableStream(url: string): boolean {
  if (!url) return false;
  return !/\.(m3u|pls|asx)(\?|$)/i.test(url);
}

function normalizeTags(raw?: string): string[] {
  return (raw ?? '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function mapStation(raw: RadioBrowserStation, source: RadioStation['source']): RadioStation | null {
  const streamUrl = raw.url_resolved?.trim();
  const name = raw.name?.trim();
  if (!raw.stationuuid || !name || !streamUrl || !isPlayableStream(streamUrl)) return null;
  return {
    id: raw.stationuuid,
    name,
    streamUrl,
    favicon: raw.favicon || undefined,
    country: raw.country || undefined,
    tags: normalizeTags(raw.tags),
    codec: raw.codec || undefined,
    bitrate: typeof raw.bitrate === 'number' ? raw.bitrate : undefined,
    homepage: raw.homepage || undefined,
    source,
  };
}

function dedupeStations(stations: RadioStation[]): RadioStation[] {
  const seen = new Set<string>();
  return stations.filter(station => {
    const key = `${station.id}|${station.streamUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchStations(url: string, source: RadioStation['source'], signal?: AbortSignal): Promise<RadioStation[]> {
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Katalog stacji zwrócił błąd ${response.status}.`);
  }
  const payload = await response.json() as RadioBrowserStation[];
  return dedupeStations(payload.map(item => mapStation(item, source)).filter(Boolean) as RadioStation[]);
}

export async function fetchFeaturedStations(signal?: AbortSignal): Promise<RadioStation[]> {
  return fetchStations(`${API_BASE}/stations/topclick/24`, 'featured', signal);
}

export async function searchStations(query: string, signal?: AbortSignal): Promise<RadioStation[]> {
  const term = query.trim();
  if (!term) return fetchFeaturedStations(signal);

  const byName = new URLSearchParams({
    limit: '30',
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
    name: term,
  });

  const matchesByName = await fetchStations(`${API_BASE}/stations/search?${byName.toString()}`, 'search', signal);
  if (matchesByName.length > 0) return matchesByName;

  const byTag = new URLSearchParams({
    limit: '30',
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
    tagList: term,
  });

  return fetchStations(`${API_BASE}/stations/search?${byTag.toString()}`, 'search', signal);
}