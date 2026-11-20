import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdminSession } from '@/lib/auth/session';
import { deleteDocument } from '@/lib/rag/fts';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const docId = decodeURIComponent(params.id).trim();
    const body = (await request.json()) as {
      status?: 'VIGENTE' | 'DEROGADA';
      validUntil?: string | null;
    };

    const nextStatus: 'VIGENTE' | 'DEROGADA' =
      body.status === 'DEROGADA' ? 'DEROGADA' : 'VIGENTE';

    const db = await getDb();
    const res = await db.execute(
      `UPDATE rag_documents
       SET status = $1,
           valid_until = COALESCE($2, valid_until)
       WHERE id = $3 AND municipality_id = $4`,
      [
        nextStatus,
        body.validUntil !== undefined ? body.validUntil : null,
        docId,
        auth.session.municipalityId,
      ]
    );

    if (res.changes === 0) {
      return NextResponse.json(
        { error: 'Documento no encontrado en tu municipio.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      id: docId,
      status: nextStatus,
    });
  } catch (error) {
    console.error('Error in PATCH /api/admin/rag/[id]:', error);
    return NextResponse.json(
      { error: 'No se pudo actualizar la vigencia del documento.' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const docId = decodeURIComponent(params.id).trim();
    const result = await deleteDocument(auth.session.municipalityId, docId);
    if (!result.deleted) {
      return NextResponse.json(
        { error: 'Documento no encontrado en tu municipio.' },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in DELETE /api/admin/rag/[id]:', error);
    return NextResponse.json(
      { error: 'No se pudo eliminar el documento.' },
      { status: 500 }
    );
  }
}
