import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/auth/session';
import { extractTextFromFile, ingestDocument } from '@/lib/rag/fts';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const contentType = request.headers.get('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      const validUntil = (formData.get('validUntil') as string | null) ?? null;
      const sourceUrl = (formData.get('sourceUrl') as string | null) ?? null;

      if (!file) {
        return NextResponse.json(
          { error: 'Adjunta un archivo .pdf, .txt o .md.' },
          { status: 400 }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const text = await extractTextFromFile(buffer, file.name);
      const ext = file.name.split('.').pop()?.toUpperCase() || 'TXT';

      const ingested = await ingestDocument({
        municipalityId: auth.session.municipalityId,
        filename: file.name,
        docType: ext,
        text,
        uploadedBy: auth.session.userId,
        sourceUrl,
        validUntil,
        status: 'VIGENTE',
      });

      return NextResponse.json({ document: ingested }, { status: 201 });
    }

    // Ingesta directa de texto o URL oficial
    const body = (await request.json()) as {
      title?: string;
      text?: string;
      sourceUrl?: string;
      validUntil?: string;
    };

    const title = (body.title ?? '').trim() || 'Normativa_Oficial.txt';
    const sourceUrl = (body.sourceUrl ?? '').trim() || null;
    const validUntil = (body.validUntil ?? '').trim() || null;
    let text = (body.text ?? '').trim();

    if (!text && sourceUrl) {
      try {
        const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const html = await res.text();
          text = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        }
      } catch {
        // Fallback if remote URL is unreachable
      }
    }

    if (!text || text.length < 10) {
      return NextResponse.json(
        { error: 'Introduce el contenido del documento o una URL accesible.' },
        { status: 400 }
      );
    }

    const filename = /\.(pdf|txt|md)$/i.test(title) ? title : `${title}.txt`;
    const docType = sourceUrl ? 'URL' : 'TXT';

    const ingested = await ingestDocument({
      municipalityId: auth.session.municipalityId,
      filename,
      docType,
      text,
      uploadedBy: auth.session.userId,
      sourceUrl,
      validUntil,
      status: 'VIGENTE',
    });

    return NextResponse.json({ document: ingested }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/admin/rag/upload:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'No se pudo indexar el documento.',
      },
      { status: 500 }
    );
  }
}
