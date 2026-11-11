import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { immichConfigured, photosOnThisDay } from '@/lib/immich';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!immichConfigured()) return NextResponse.json({ configured: false, years: [], total: 0 });
  const date = request.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'A valid date is required.' }, { status: 400 });
  try {
    return NextResponse.json({ configured: true, ...await photosOnThisDay(date) });
  } catch {
    return NextResponse.json({ error: 'Could not load Immich photos.' }, { status: 502 });
  }
}
