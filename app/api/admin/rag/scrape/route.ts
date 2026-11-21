import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';
import { requireAdminSession } from '@/lib/auth/session';
import {
  loadOfficialMunicipalDataset,
  runLiveMunicipalScraper,
} from '@/lib/rag/scraper';
import { ingestScrapedDocumentsBatch } from '@/lib/rag/fts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      mode?: 'official_sync' | 'live_scrape';
      customSedeUrl?: string;
      customWebUrl?: string;
      maxPages?: number;
      validUntil?: string | null;
    };

    const mode: 'official_sync' | 'live_scrape' =
      body.mode === 'live_scrape' ? 'live_scrape' : 'official_sync';

    const db = await getDb();
    const municipality = await resolveMunicipality(
      db,
      auth.session.municipalityId
    );
    if (!municipality) {
      return NextResponse.json(
        { error: 'Municipio no encontrado.' },
        { status: 404 }
      );
    }

    if (mode === 'live_scrape') {
      const safeMaxPages = Math.min(Math.max(Number(body.maxPages) || 25, 5), 70);
      const scraped = await runLiveMunicipalScraper({
        municipalitySlug: municipality.slug,
        municipalityName: municipality.name,
        province: municipality.province,
        customSedeUrl: body.customSedeUrl,
        customWebUrl: body.customWebUrl,
        maxCatalogItems: safeMaxPages,
        maxWebPages: 6,
        timeoutBudgetMs: 36_000,
      });

      const ingested = await ingestScrapedDocumentsBatch({
        municipalityId: municipality.id,
        documents: scraped.documents,
        uploadedBy: auth.session.userId,
        validUntil: body.validUntil ?? null,
      });

      return NextResponse.json({
        ok: true,
        mode,
        municipalityName: municipality.name,
        documentsIndexed: ingested.documentsIndexed,
        chunksIndexed: ingested.chunksIndexed,
        vectorsGenerated: ingested.vectorsGenerated,
        embeddingModel: ingested.embeddingModel,
        liveScrapedCount: scraped.liveScrapedCount,
        sedePagesCount: scraped.sedePagesCount,
        tramitesCount: scraped.tramitesCount,
        webPagesCount: scraped.webPagesCount,
        lawsCount: scraped.lawsCount,
        usedOfficialFallback: scraped.usedOfficialFallback,
        warnings: scraped.warnings,
      });
    }

    // Modo por defecto: official_sync (rápido e infalible para demo en Vercel)
    const officialDocs = loadOfficialMunicipalDataset(
      municipality.slug,
      municipality.name,
      municipality.province
    );

    const tramitesCount = officialDocs.filter(
      (d) => d.categoria === 'tramite_sede'
    ).length;
    const lawsCount = officialDocs.filter((d) =>
      d.categoria.startsWith('ley_boe')
    ).length;
    const sedePagesCount = officialDocs.length - tramitesCount - lawsCount;

    const ingested = await ingestScrapedDocumentsBatch({
      municipalityId: municipality.id,
      documents: officialDocs,
      uploadedBy: auth.session.userId,
      validUntil: body.validUntil ?? null,
    });

    return NextResponse.json({
      ok: true,
      mode: 'official_sync',
      municipalityName: municipality.name,
      documentsIndexed: ingested.documentsIndexed,
      chunksIndexed: ingested.chunksIndexed,
      vectorsGenerated: ingested.vectorsGenerated,
      embeddingModel: ingested.embeddingModel,
      liveScrapedCount: officialDocs.length,
      sedePagesCount,
      tramitesCount,
      webPagesCount: 0,
      lawsCount,
      usedOfficialFallback: false,
      warnings: [],
    });
  } catch (error) {
    console.error('Error in POST /api/admin/rag/scrape:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo completar el scraping y vectorización municipal.',
      },
      { status: 500 }
    );
  }
}
