import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { immichConfigured, photoPreview } from '@/lib/immich';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, context: RouteContext<'/api/immich/thumbnail/[id]'>) {
  if (!await isAuthenticated()) return new NextResponse('Unauthorized', { status: 401 });
  if (!immichConfigured()) return new NextResponse('Not found', { status: 404 });
  const { id } = await context.params;
  try {
    const preview = await photoPreview(id);
    if (!preview) return new NextResponse('Not found', { status: 404 });
    return new NextResponse(preview.bytes, {
      headers: {
        'Content-Type': preview.contentType,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse('Could not load photo', { status: 502 });
  }
}
