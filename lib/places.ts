import { fetchT } from './http';

// Google Places API v1 — https://places.googleapis.com/v1/
// Replaces the legacy maps.googleapis.com/maps/api/place/* endpoints.
// Auth: X-Goog-Api-Key header (same key as before).
// Field masks use dot-notation: "places.id", "websiteUri", etc.

const BASE = 'https://places.googleapis.com/v1';
const apiKey = () => process.env.GOOGLE_PLACES_API_KEY ?? '';

export interface PlaceResult {
  place_id: string;
  name: string;
  rating: number;
  user_ratings_total: number;
}

export interface PlaceDetails {
  website: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
}

// POST /v1/places:searchText
// Returns up to 20 results per page; use nextPageToken for subsequent pages.
// locationBias radius is in metres (default 15 km).
// strictToArea=true uses locationRestriction (hard boundary) instead of locationBias,
// which gives rankings much closer to what users see when searching on Google Maps.
export async function placesTextSearch(
  textQuery: string,
  locationBias?: { lat: number; lng: number; radius?: number },
  pageToken?: string,
  strictToArea = false,
): Promise<{ results: PlaceResult[]; nextPageToken?: string }> {
  if (!apiKey()) return { results: [] };
  const body: Record<string, any> = { textQuery, maxResultCount: 20, rankPreference: 'RELEVANCE' };
  if (locationBias) {
    const radius = locationBias.radius ?? 15000;
    if (strictToArea) {
      // LocationRestriction only supports a rectangular viewport, not a circle —
      // approximate the radius as a bounding box around the centre point.
      const latDelta = radius / 111320;
      const lngDelta = radius / (111320 * Math.cos(locationBias.lat * Math.PI / 180));
      body.locationRestriction = {
        rectangle: {
          low:  { latitude: locationBias.lat - latDelta, longitude: locationBias.lng - lngDelta },
          high: { latitude: locationBias.lat + latDelta, longitude: locationBias.lng + lngDelta },
        },
      };
    } else {
      body.locationBias = {
        circle: {
          center: { latitude: locationBias.lat, longitude: locationBias.lng },
          radius,
        },
      };
    }
  }
  if (pageToken) body.pageToken = pageToken;
  try {
    const res = await fetchT(`${BASE}/places:searchText`, {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': apiKey(),
        'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,nextPageToken',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, 15000);
    const json = await res.json();
    if (json.error) {
      console.warn('[Places] textSearch API error:', json.error?.message ?? JSON.stringify(json.error));
      return { results: [] };
    }
    const results: PlaceResult[] = (json.places ?? []).map((p: any) => ({
      place_id:           p.id ?? '',
      name:               p.displayName?.text ?? '',
      rating:             p.rating ?? 0,
      user_ratings_total: p.userRatingCount ?? 0,
    }));
    return { results, nextPageToken: json.nextPageToken };
  } catch (e: any) {
    console.warn('[Places] textSearch error:', e.message);
    return { results: [] };
  }
}

// GET /v1/places/{id} — full details for a single place.
// Field names (v1): websiteUri, nationalPhoneNumber, formattedAddress,
//   addressComponents[].longText / .types, location.latitude / .longitude
export async function placeDetails(place_id: string): Promise<PlaceDetails> {
  const empty: PlaceDetails = { website: '', phone: '', address: '', city: '', state: '', lat: null, lng: null };
  if (!apiKey() || !place_id) return empty;
  try {
    const res = await fetchT(`${BASE}/places/${place_id}`, {
      headers: {
        'X-Goog-Api-Key': apiKey(),
        'X-Goog-FieldMask': 'websiteUri,nationalPhoneNumber,formattedAddress,addressComponents,location',
      },
    }, 10000);
    const j = await res.json();
    if (j.error) return empty;
    const comps: any[] = j.addressComponents ?? [];
    const city  = comps.find((c: any) => c.types?.includes('locality'))?.longText ?? '';
    const state = comps.find((c: any) => c.types?.includes('administrative_area_level_1'))?.longText ?? '';
    return {
      website: j.websiteUri ?? '',
      phone:   j.nationalPhoneNumber ?? '',
      address: j.formattedAddress ?? '',
      city,
      state,
      lat: j.location?.latitude  ?? null,
      lng: j.location?.longitude ?? null,
    };
  } catch { return empty; }
}

// GET /v1/places/{id} — rating + review count only (enriches scraped Maps results,
// whose list view sometimes omits the review count).
export async function placeRatingCount(place_id: string): Promise<{ rating: number; count: number } | null> {
  if (!apiKey() || !place_id) return null;
  try {
    const res = await fetchT(`${BASE}/places/${place_id}`, {
      headers: { 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': 'rating,userRatingCount' },
    }, 8000);
    const j = await res.json();
    if (j.error) return null;
    return { rating: j.rating ?? 0, count: j.userRatingCount ?? 0 };
  } catch { return null; }
}

// GET /v1/places/{id} — websiteUri only (for competitor domain lookup).
export async function placeWebsite(place_id: string): Promise<string> {
  if (!apiKey() || !place_id) return '';
  try {
    const res = await fetchT(`${BASE}/places/${place_id}`, {
      headers: { 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': 'websiteUri' },
    }, 8000);
    const j = await res.json();
    return j.websiteUri ?? '';
  } catch { return ''; }
}

// GET /v1/places/{id} — nationalPhoneNumber only.
export async function placePhone(place_id: string): Promise<string> {
  if (!apiKey() || !place_id) return '';
  try {
    const res = await fetchT(`${BASE}/places/${place_id}`, {
      headers: { 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': 'nationalPhoneNumber' },
    }, 8000);
    const j = await res.json();
    return j.nationalPhoneNumber ?? '';
  } catch { return ''; }
}

// GET /v1/places/{id} — location (lat/lng) only.
export async function placeCoords(place_id: string): Promise<{ lat: number; lng: number } | null> {
  if (!apiKey() || !place_id) return null;
  try {
    const res = await fetchT(`${BASE}/places/${place_id}`, {
      headers: { 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': 'location' },
    }, 8000);
    const j = await res.json();
    const loc = j.location;
    if (loc?.latitude != null && loc?.longitude != null) {
      return { lat: loc.latitude as number, lng: loc.longitude as number };
    }
    return null;
  } catch { return null; }
}
