import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/auth/session';
import {
  extractTextFromFile,
  ingestDocument,
  ingestScrapedDocumentsBatch,
  parseUploadedJsonDocuments,
} from '@/lib/rag/fts';
import { scrapeSingleOfficialUrl } from '@/lib/rag/scraper';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
          { error: 'Adjunta un archivo .pdf, .txt, .md o .json.' },
          { status: 400 }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith('.json')) {
        const jsonDocs = parseUploadedJsonDocuments(buffer, file.name);
        if (jsonDocs.length > 1) {
          const batchResult = await ingestScrapedDocumentsBatch({
            municipalityId: auth.session.municipalityId,
            documents: jsonDocs,
            uploadedBy: auth.session.userId,
            validUntil,
          });
          return NextResponse.json(
            {
              batch: batchResult,
              message: `${batchResult.documentsIndexed} documentos JSON indexados (${batchResult.chunksIndexed} fragmentos).`,
            },
            { status: 201 }
          );
        }
      }

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

    // Ingesta directa de texto o URL oficial con limpieza DOM
    const body = (await request.json()) as {
      title?: string;
      text?: string;
      sourceUrl?: string;
      category?: string;
      validUntil?: string;
    };

    let title = (body.title ?? '').trim();
    const sourceUrl = (body.sourceUrl ?? '').trim() || null;
    const validUntil = (body.validUntil ?? '').trim() || null;
    const category = (body.category ?? '').trim() || (sourceUrl ? 'sede_electronica' : 'normativa_municipal');
    let text = (body.text ?? '').trim();

    if (!text && sourceUrl) {
      const scraped = await scrapeSingleOfficialUrl(
        sourceUrl,
        title || 'Fuente_Oficial_Municipal'
      );
      text = scraped.text;
      if (!title && scraped.title) {
        title = scraped.title;
      }
    }

    if (!title) {
      title = 'Normativa_Oficial.txt';
    }

    if (!text || text.length < 10) {
      return NextResponse.json(
        { error: 'Introduce el contenido del documento o una URL oficial accesible.' },
        { status: 400 }
      );
    }

    const filename = /\.(pdf|txt|md|json)$/i.test(title) ? title : title;
    const docType = sourceUrl ? 'URL' : 'TXT';

    const ingested = await ingestDocument({
      municipalityId: auth.session.municipalityId,
      filename,
      docType,
      category,
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
