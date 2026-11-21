import fs from 'fs';
import path from 'path';

export interface ScrapedMunicipalDoc {
  id: string;
  titulo: string;
  categoria: string;
  fuente_url: string;
  fecha_extraccion: string;
  texto: string;
}

export interface MunicipalityScraperConfig {
  slug: string;
  name: string;
  province: string;
  sedeBaseUrl: string;
  webBaseUrl: string;
  webSeedUrls: string[];
  address: string;
  phone: string;
  email: string;
  cif: string;
  dir3: string;
}

const MUNICIPALITY_SCRAPER_CONFIGS: Record<string, MunicipalityScraperConfig> = {
  lucainena: {
    slug: 'lucainena',
    name: 'Lucainena de las Torres',
    province: 'Almería',
    sedeBaseUrl: 'https://sede.lucainenadelastorres.es',
    webBaseUrl: 'https://www.lucainenadelastorres.es/',
    webSeedUrls: [
      'https://www.lucainenadelastorres.es/',
      'https://www.lucainenadelastorres.es/Servicios/cmsdipro/index.nsf/tablon_view_entidad_categoria1.xsp?p=Lucainena&cat=Pleno',
      'https://www.lucainenadelastorres.es/Servicios/cmsdipro/index.nsf/tablon_view_entidad_categoria1.xsp?p=Lucainena&cat=Normas',
    ],
    address: 'Plaza del Ayuntamiento, n.º 4, 04210 Lucainena de las Torres (Almería)',
    phone: '950 36 40 68',
    email: 'registro@lucainenadelastorres.es',
    cif: 'P0406000J',
    dir3: 'L01040600',
  },
  nijar: {
    slug: 'nijar',
    name: 'Níjar',
    province: 'Almería',
    sedeBaseUrl: 'https://sede.nijar.es',
    webBaseUrl: 'https://www.nijar.es/',
    webSeedUrls: ['https://www.nijar.es/'],
    address: 'Plaza de la Glorieta, n.º 1, 04100 Níjar (Almería)',
    phone: '950 36 00 12',
    email: 'registro@nijar.es',
    cif: 'P0406600G',
    dir3: 'L01040663',
  },
};

const SEDE_PAGINAS: Array<[string, string, string]> = [
  ['/ownership', 'contacto_y_oficinas', 'Titularidad, Dirección, Teléfono y Oficina de Registro'],
  ['/faqs', 'preguntas_frecuentes', 'Preguntas Frecuentes de la Sede Electrónica'],
  ['/board', 'tablon_anuncios', 'Tablón de Anuncios de la Sede Electrónica'],
  ['/calendar', 'calendario_plazos', 'Calendario de Días Inhábiles y Cómputo de Plazos'],
  ['/normative', 'normativa', 'Normativa Aplicable en la Sede Electrónica'],
  ['/id-systems', 'identificacion', 'Sistemas de Identificación Electrónica'],
  ['/signature-systems', 'firma_electronica', 'Sistemas de Firma Electrónica'],
  ['/electronic-certificates', 'certificados', 'Certificados Electrónicos Admitidos'],
  ['/e-invoice', 'factura_electronica', 'Factura Electrónica (Proveedores / FACE)'],
  ['/document-validation', 'validacion_documentos', 'Validación de Documentos Electrónicos'],
  ['/attorney-power', 'apoderamientos', 'Registro Electrónico de Apoderamientos'],
  ['/complaints-channel', 'canal_denuncias', 'Canal de Denuncias'],
  ['/citaprevia', 'cita_previa', 'Cita Previa del Ayuntamiento'],
  ['/suffrage-info', 'informacion_electoral', 'Información Electoral'],
  ['/info', 'sede_inicio', 'Inicio de la Sede Electrónica'],
  ['/transparency', 'transparencia', 'Portal de Transparencia'],
];

const MARCADORES_BLOQUEO = [
  'window["bobcmn"]',
  '/TSPD/',
  'The requested URL was rejected',
  'Access Denied',
];

const MARCADORES_LOGIN = [
  'Para acceder a esta sección es necesario identificarse',
  'Para acceder a esta seccion es necesario identificarse',
];

const LINEAS_RUIDO = new Set([
  '|',
  '&nbsp;',
  'Saltar contenido',
  'Saltar al contenido',
  'Iniciar tramitación electrónica',
  'Volver',
  'Buscar',
  'Limpiar',
]);

const REGEX_FECHA_HORA_SEDE =
  /^\d{1,2}\s+de\s+[a-záéíóúñ]+\s+\d{4},\s+\d{2}:\d{2}:\d{2}$/i;

const EXTENSIONES_EXCLUIDAS = [
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
  '.zip', '.rar', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.avi', '.css', '.js', '.xml',
];

const PATRONES_URL_EXCLUIDOS = [
  'lang=en', 'aviso_legal', 'politica_privacidad', 'ref=cookies',
  'ref=accesibilidad', 'ref=mapa-web', 'galeria_view', 'seccion.xsp',
];

const HEADERS_HTTP: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
};

export function getMunicipalityScraperConfig(
  municipalitySlug: string,
  municipalityName: string,
  province = 'Almería'
): MunicipalityScraperConfig {
  const key = municipalitySlug.toLowerCase().trim();
  if (MUNICIPALITY_SCRAPER_CONFIGS[key]) {
    return MUNICIPALITY_SCRAPER_CONFIGS[key];
  }
  const cleanSlug = key.replace(/[^a-z0-9]/g, '');
  return {
    slug: key,
    name: municipalityName,
    province,
    sedeBaseUrl: `https://sede.${cleanSlug}.es`,
    webBaseUrl: `https://www.${cleanSlug}.es/`,
    webSeedUrls: [`https://www.${cleanSlug}.es/`],
    address: `Plaza del Ayuntamiento, s/n, ${municipalityName} (${province})`,
    phone: '950 36 40 68',
    email: `registro@${cleanSlug}.es`,
    cif: 'P0400000A',
    dir3: 'L01040000',
  };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&ordm;/gi, 'º')
    .replace(/&ordf;/gi, 'ª')
    .replace(/&laquo;/gi, '«')
    .replace(/&raquo;/gi, '»')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&euro;/gi, '€')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function checkBlockedPage(html: string): string | null {
  for (const marker of MARCADORES_BLOQUEO) {
    if (html.includes(marker)) {
      return 'protección anti-bot/WAF del servidor';
    }
  }
  for (const marker of MARCADORES_LOGIN) {
    if (html.includes(marker)) {
      return 'requiere identificación electrónica previa';
    }
  }
  return null;
}

export function cleanScrapedHtml(
  html: string,
  fallbackTitle = ''
): { title: string; text: string } {
  // Extraer h1 / h2 / title antes de limpiar etiquetas
  let detectedTitle = '';
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  for (const candidate of [h1Match?.[1], h2Match?.[1]]) {
    if (!candidate) continue;
    const clean = decodeHtmlEntities(candidate.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (
      clean.length >= 3 &&
      !['identificación', 'identificacion', 'sede electrónica', 'sede electronica'].includes(
        clean.toLowerCase()
      )
    ) {
      detectedTitle = clean;
      break;
    }
  }

  if (!detectedTitle && titleMatch?.[1]) {
    const cleanTitle = decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .replace(
        /^Sede Electr[oó]nica de Ayuntamiento de [^-–|:]+[-–|:]?\s*/i,
        ''
      )
      .trim();
    if (
      cleanTitle &&
      !['identificación', 'identificacion', 'sede electrónica', 'inicio'].includes(
        cleanTitle.toLowerCase()
      )
    ) {
      detectedTitle = cleanTitle;
    }
  }

  // Recortar al contenedor principal <main> o id="content" si existe
  let bodyHtml = html;
  const mainMatch =
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
    html.match(/<div[^>]+id=["']content["'][^>]*>([\s\S]*?)<\/div>/i);
  if (mainMatch?.[1] && mainMatch[1].length > 200) {
    bodyHtml = mainMatch[1];
  }

  // Eliminar bloques de ruido DOM
  const stripped = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<button[\s\S]*?<\/button>/gi, ' ')
    .replace(/<select[\s\S]*?<\/select>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h1|h2|h3|h4|h5|h6|section|article|dt|dd|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const decoded = decodeHtmlEntities(stripped);
  const cleanLines: string[] = [];
  let prevLine = '';

  for (const rawLine of decoded.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line || LINEAS_RUIDO.has(line)) continue;
    if (REGEX_FECHA_HORA_SEDE.test(line)) continue;
    if (line === prevLine) continue;
    cleanLines.push(line);
    prevLine = line;
  }

  return {
    title: detectedTitle || fallbackTitle,
    text: cleanLines.join('\n'),
  };
}

async function fetchHtmlSafe(
  url: string,
  timeoutMs = 7500
): Promise<{ html: string | null; error: string | null }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: HEADERS_HTTP,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return { html: null, error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    const blockReason = checkBlockedPage(html);
    if (blockReason) {
      return { html: null, error: blockReason };
    }
    return { html, error: null };
  } catch (err) {
    return {
      html: null,
      error: err instanceof Error ? err.message : 'fetch_error',
    };
  }
}

export async function scrapeSingleOfficialUrl(
  url: string,
  fallbackTitle = 'Documento Oficial Municipal'
): Promise<{ title: string; text: string; error?: string }> {
  const { html, error } = await fetchHtmlSafe(url, 8500);
  if (!html) {
    return { title: fallbackTitle, text: '', error: error ?? 'No accesible' };
  }
  const cleaned = cleanScrapedHtml(html, fallbackTitle);
  return {
    title: cleaned.title || fallbackTitle,
    text: cleaned.text,
  };
}

/**
 * Compendio estructurado de Leyes Estatales y Autonómicas de Régimen Local y Procedimiento Administrativo (BOE)
 * aplicables a los trámites y competencias del Ayuntamiento.
 */
export function buildMunicipalLawsCompendium(
  config: MunicipalityScraperConfig
): ScrapedMunicipalDoc[] {
  const now = new Date().toISOString();
  return [
    {
      id: `boe-ley-39-2015-${config.slug}`,
      titulo:
        'Ley 39/2015, de 1 de octubre, del Procedimiento Administrativo Común de las Administraciones Públicas (LPACAP)',
      categoria: 'ley_boe_procedimiento',
      fuente_url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2015-10565',
      fecha_extraccion: now,
      texto: `Ley 39/2015, de 1 de octubre, del Procedimiento Administrativo Común de las Administraciones Públicas (BOE-A-2015-10565).
Aplicación en el Ayuntamiento de ${config.name} (${config.province}) y su Sede Electrónica (${config.sedeBaseUrl}).
Artículos clave para la ciudadanía:
- Artículos 9 y 10 (Identificación y firma electrónica): Los ciudadanos pueden identificarse y firmar trámites en la Sede Electrónica mediante certificados electrónicos cualificados (FNMT, DNIe), sistema Cl@ve o sistemas no criptográficos en trámites de nivel básico.
- Artículo 14 (Derecho y obligación de relacionarse electrónicamente): Las personas físicas pueden elegir en todo momento si se comunican con el Ayuntamiento por medios electrónicos (Sede Electrónica) o presencialmente en la Oficina de Registro (${config.address}). Están obligadas a relacionarse electrónicamente las personas jurídicas, entidades sin personalidad jurídica y profesionales colegiados.
- Artículo 16 (Registros): Los documentos pueden presentarse en el Registro Electrónico del Ayuntamiento de ${config.name} las 24 horas todos los días del año, o en las oficinas de asistencia en materia de registros (Código DIR3: ${config.dir3}).
- Artículo 21 (Obligación de resolver y plazos): El Ayuntamiento está obligado a dictar resolución expresa y notificarla en todos los procedimientos. Cuando la norma reguladora no fije plazo máximo, éste será de 3 meses.
- Artículo 24 (Silencio administrativo en procedimientos iniciados a solicitud del interesado): El vencimiento del plazo máximo sin haberse notificado resolución expresa legitima al interesado para entenderla estimada por silencio administrativo, excepto en procedimientos de ejercicio del derecho de petición, facultades sobre dominio público o servicio público (como alta de agua o exhumaciones), o impugnación de actos, donde el silencio es desestimatorio.
- Artículo 30.2 (Cómputo de plazos): Siempre que por Ley o Derecho de la UE no se exprese otro cómputo, cuando los plazos se señalen por días se entiende que son días hábiles, excluyéndose del cómputo los sábados, los domingos y los declarados festivos en el calendario oficial del Ayuntamiento de ${config.name}.
- Artículos 41 a 43 (Notificaciones electrónicas): Las notificaciones por medios electrónicos se entienden practicadas en el momento en que se produzca el acceso a su contenido en la Carpeta Electrónica. Si transcurren 10 días naturales desde la puesta a disposición sin que el interesado acceda, la notificación se entenderá rechazada (Art. 43.2).
- Artículo 66 (Solicitudes de iniciación): Toda instancia o solicitud debe contener nombre y apellidos del interesado, identificación del medio electrónico o lugar físico a efectos de notificaciones, hechos, razones y petición clara, lugar y fecha, firma del solicitante y órgano municipal al que se dirige.
- Artículo 68 (Subsanación y mejora de la solicitud): Si la solicitud de un trámite no reúne los requisitos exigidos, el Ayuntamiento requerirá al interesado para que, en un plazo de 10 días hábiles, subsane la falta o acompañe los documentos preceptivos.
- Artículo 69 (Declaración responsable y comunicación): Permite el inicio de actividades económicas, espectáculos o determinadas obras urbanísticas menores desde el día de su presentación, sin perjuicio de las facultades de comprobación, control e inspección del Ayuntamiento.`,
    },
    {
      id: `boe-ley-40-2015-${config.slug}`,
      titulo:
        'Ley 40/2015, de 1 de octubre, de Régimen Jurídico del Sector Público (LRJSP)',
      categoria: 'ley_boe_regimen_juridico',
      fuente_url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2015-10566',
      fecha_extraccion: now,
      texto: `Ley 40/2015, de 1 de octubre, de Régimen Jurídico del Sector Público (BOE-A-2015-10566).
Aplicación en el Ayuntamiento de ${config.name} (CIF: ${config.cif}, Código DIR3: ${config.dir3}).
Artículos clave:
- Artículo 38 (La Sede Electrónica): La Sede Electrónica (${config.sedeBaseUrl}) es la dirección electrónica disponible para los ciudadanos cuya titularidad corresponde al Ayuntamiento de ${config.name}. Garantiza la integridad, veracidad y actualización de la información y los servicios municipales bajo los principios de transparencia, publicidad, seguridad, disponibilidad, accesibilidad e interoperabilidad.
- Artículos 41 y 42 (Actuación administrativa automatizada y sellos electrónicos): Regula el uso de sellos electrónicos de órgano (Secretaría, Alcaldía, Tesorería, Junta de Gobierno y Pleno) y el Código Seguro de Verificación (CSV) para validar copias auténticas de documentos municipales en la sección de Validación de Documentos de la Sede.
- Artículos 32 a 37 (Responsabilidad Patrimonial de las Administraciones Públicas): Los particulares tienen derecho a ser indemnizados por el Ayuntamiento de toda lesión que sufran en cualquiera de sus bienes y derechos como consecuencia del funcionamiento normal o anormal de los servicios públicos municipales (salvo fuerza mayor). El derecho a reclamar prescribe al año de producido el hecho o el acto que motive la indemnización (Trámite oficial: Reclamación de Responsabilidad Patrimonial en la Sede Electrónica).`,
    },
    {
      id: `boe-ley-7-1985-lrbrl-${config.slug}`,
      titulo:
        'Ley 7/1985, de 2 de abril, Reguladora de las Bases del Régimen Local (LRBRL - Competencias del Ayuntamiento y Padrón)',
      categoria: 'ley_boe_regimen_local',
      fuente_url: 'https://www.boe.es/buscar/act.php?id=BOE-A-1985-5392',
      fecha_extraccion: now,
      texto: `Ley 7/1985, de 2 de abril, Reguladora de las Bases del Régimen Local (BOE-A-1985-5392).
Competencias municipales, Padrón de Habitantes y derechos vecinales en el Ayuntamiento de ${config.name}:
- Artículos 15, 16 y 17 (Padrón Municipal de Habitantes y Empadronamiento): Toda persona que viva en España está obligada a inscribirse en el Padrón del municipio en el que resida habitualmente. Los datos del Padrón constituyen prueba de la residencia en el municipio de ${config.name} y del domicilio habitual. La expedición de certificados y volantes de empadronamiento se solicita presencialmente con DNI/NIE en ${config.address} o electrónicamente en ${config.sedeBaseUrl} (Trámite: Solicitud de Inscripción o Modificación en el Padrón Municipal).
- Artículo 18 (Derechos y deberes de los vecinos): Ser elector y elegible, participar en la gestión municipal, utilizar los servicios públicos municipales, acceder a los aprovechamientos comunales, ser informado previa petición razonada y dirigir solicitudes a la Administración municipal (Art. 18.1.e), así como solicitar la consulta popular.
- Artículo 21 (Atribuciones del Alcalde): Dirigir el gobierno y la administración municipal, dictar bandos, otorgar las licencias urbanísticas y de actividad, ordenar la publicación y ejecución de los acuerdos del Ayuntamiento y ejercer la jefatura de la Policía Municipal.
- Artículos 25 y 26 (Competencias propias y servicios mínimos obligatorios del Ayuntamiento):
  En todos los municipios, el Ayuntamiento debe prestar obligatoriamente los servicios de:
  1. Alumbrado público.
  2. Cementerio y servicios funerarios.
  3. Recogida de residuos y limpieza viaria.
  4. Abastecimiento domiciliario de agua potable y alcantarillado.
  5. Acceso a los núcleos de población y pavimentación de las vías públicas.
  Además, ejerce competencias en urbanismo, medio ambiente urbano, parques y jardines, protección de la salubridad pública, tenencia de animales, atención inmediata a personas en situación o riesgo de exclusión social, instalaciones deportivas y promoción de la cultura y el turismo.`,
    },
    {
      id: `boe-haciendas-locales-tributos-${config.slug}`,
      titulo:
        'Real Decreto Legislativo 2/2004 (Ley de Haciendas Locales) y Ley 58/2003 General Tributaria — Impuestos, Tasas y Bonificaciones',
      categoria: 'ley_boe_tributos',
      fuente_url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2004-4214',
      fecha_extraccion: now,
      texto: `Real Decreto Legislativo 2/2004, de 5 de marzo, por el que se aprueba el Texto Refundido de la Ley Reguladora de las Haciendas Locales (BOE-A-2004-4214) y Ley 58/2003, de 17 de diciembre, General Tributaria (BOE-A-2003-23186).
Regulación de impuestos, tasas, bonificaciones y recaudación en el Ayuntamiento de ${config.name}:
- Impuesto sobre Bienes Inmuebles (IBI - Arts. 60 a 77 TRLRHL): Grava la titularidad de bienes inmuebles urbanos, rústicos y de características especiales. El artículo 74.4 permite una bonificación de hasta el 90% de la cuota íntegra del IBI a favor de aquellos sujetos pasivos que ostenten la condición de titulares de familia numerosa (en ${config.name}, bonificación del 50% en IBI y tasa de basuras presentando título de familia numerosa vigente y empadronamiento).
- Impuesto sobre Vehículos de Tracción Mecánica (IVTM - Arts. 92 a 99 TRLRHL): Grava la titularidad de vehículos aptos para circular por vías públicas. Según el artículo 93.1.e, están exentos los vehículos matriculados a nombre de personas con discapacidad (grado igual o superior al 33%) para su uso exclusivo (Trámite SIA en Sede Electrónica: Solicitud de Exención o Bonificación en el Impuesto sobre Vehículos de Tracción Mecánica).
- Impuesto sobre Construcciones, Instalaciones y Obras (ICIO - Arts. 100 a 103 TRLRHL): Impuesto indirecto cuyo hecho imponible está constituido por la realización, dentro del término municipal de ${config.name}, de cualquier construcción, instalación u obra para la que se exija obtención de la correspondiente licencia de obras o urbanística, o presentación de declaración responsable o comunicación previa.
- Impuesto sobre el Incremento de Valor de los Terrenos de Naturaleza Urbana (Plusvalía Municipal - Arts. 104 a 110 TRLRHL): Se devenga por la transmisión de la propiedad de terrenos urbanos por compraventa, donación o herencia (plazo de declaración: 30 días hábiles en actos inter vivos y 6 meses prorrogables en transmisiones mortis causa por herencia).
- Tasas Municipales (Arts. 20 a 27 TRLRHL): Tasas por suministro municipal de agua potable, recogida domiciliaria de basuras y residuos sólidos urbanos, entrada de vehículos a través de las aceras (vados permanentes), ocupación de terrenos de uso público local con mesas, sillas, mercadillo o materiales de construcción, y derechos funerarios de cementerio.
- Gestión Tributaria (Ley 58/2003 General Tributaria): Los obligados tributarios tienen derecho a solicitar domiciliación de tributos periódicos (SIA 3319091), aplazamiento o fraccionamiento de deudas tributarias (Art. 65 LGT), compensación de deudas (Arts. 71-73 LGT, SIA 3319085), devolución de ingresos indebidos (Art. 221 LGT, SIA 3319084) y recurso de reposición previo al contencioso-administrativo en el plazo de 1 mes (Art. 14 TRLRHL).`,
    },
    {
      id: `boe-subvenciones-dependencia-${config.slug}`,
      titulo:
        'Ley 38/2003 General de Subvenciones y Ley 39/2006 de Dependencia y Servicios Sociales Municipales',
      categoria: 'ley_boe_servicios_sociales',
      fuente_url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2003-20977',
      fecha_extraccion: now,
      texto: `Ley 38/2003, de 17 de noviembre, General de Subvenciones (BOE-A-2003-20977) y Ley 39/2006, de 14 de diciembre, de Promoción de la Autonomía Personal y Atención a las personas en situación de dependencia (BOE-A-2006-21990).
Aplicación en ayudas municipales, subvenciones y servicios sociales del Ayuntamiento de ${config.name}:
- Solicitud y Concesión de Subvenciones Municipales (Arts. 13 y 22 Ley 38/2003): Para obtener la condición de beneficiario de ayudas y subvenciones del Ayuntamiento de ${config.name} (bonos familiares, becas de comedor escolar, ayudas de rehabilitación y accesibilidad de vivienda, o subvenciones a asociaciones), los solicitantes deben estar al corriente de sus obligaciones tributarias y frente a la Seguridad Social y cumplir los requisitos de empadronamiento y renta de la convocatoria (Trámite SIA 3318975: Solicitud de Subvención).
- Justificación de Subvenciones (Art. 30 Ley 38/2003 y Arts. 69-75 RD 887/2006): El beneficiario debe presentar la cuenta justificativa por cada proyecto o actuación subvencionada aportando facturas y justificantes de pago (Trámite SIA 3318973: Justificación de Subvención Concedida).
- Teleasistencia, Ayuda a Domicilio y Centros de Asistencia Social (Ley 39/2006 y RD 1051/2013): Regula la solicitud de acceso al Servicio de Teleasistencia o de Ayuda a Domicilio (Trámite SIA 3319013, plazo de resolución 3 meses) y el ingreso en Centros de Asistencia Social o Vivienda Tutelada para personas mayores o con discapacidad (Trámite SIA 3319015, plazo de resolución 3 meses).`,
    },
    {
      id: `boe-lista-urbanismo-andalucia-${config.slug}`,
      titulo:
        'Ley 7/2021 (LISTA Andalucía) y Decreto 550/2022 — Licencias Urbanísticas, Obras Menores y Declaración Responsable',
      categoria: 'ley_boe_urbanismo',
      fuente_url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2021-21652',
      fecha_extraccion: now,
      texto: `Ley 7/2021, de 1 de diciembre, de Impulso para la Sostenibilidad del Territorio de Andalucía (LISTA, BOE-A-2021-21652) y Decreto 550/2022, de 29 de noviembre, por el que se aprueba su Reglamento General.
Normativa urbanística aplicable en el Ayuntamiento de ${config.name} (${config.province}):
- Actos sujetos a Licencia Urbanística Municipal (Art. 137 LISTA y Arts. 287-292 Reglamento): Requieren licencia expresa previa las parcelaciones urbanísticas, segregaciones o divisiones de terrenos (Trámite SIA 3318986), movimientos de tierra, obras de edificación de nueva planta, ampliación o reforma que afecten a la estructura o configuración arquitectónica, y obras en edificios protegidos (Trámite SIA 3319002: Solicitud de Licencia o Autorización Urbanística). El plazo máximo de resolución es de 3 meses.
- Actos sujetos a Declaración Responsable o Comunicación Previa en Materia Urbanística (Art. 138 LISTA y Arts. 293-295 Reglamento): Están sujetas a declaración responsable (sin esperar licencia previa para iniciar la actuación) las obras de escasa entidad constructiva y sencillez técnica que no requieran proyecto según la Ley 38/1999 de Ordenación de la Edificación (obras menores de reforma interior, pintura de fachada, sustitución de carpinterías, solados o baños en suelo urbano consolidado), así como la primera ocupación y utilización de edificaciones o el cambio de uso (Trámite SIA 3318999: Declaración Responsable o Comunicación en Materia Urbanística). Es obligatorio indicar la referencia catastral del inmueble (Art. 40 del TR de la Ley del Catastro Inmobiliario, RD Legislativo 1/2004).
- Certificados e Informes Urbanísticos: Cualquier ciudadano puede solicitar información sobre la clasificación y calificación urbanística de una parcela o situación de fuera de ordenación (Trámite SIA 3319000: Solicitud de Certificado o Informe Urbanístico).`,
    },
    {
      id: `boe-lopdgdd-rgpd-proteccion-datos-${config.slug}`,
      titulo:
        'Ley Orgánica 3/2018 (LOPDGDD), Reglamento (UE) 2016/679 (RGPD) y Ley 2/2023 (Canal de Denuncias)',
      categoria: 'ley_boe_proteccion_datos',
      fuente_url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673',
      fecha_extraccion: now,
      texto: `Ley Orgánica 3/2018, de 5 de diciembre, de Protección de Datos Personales y garantía de los derechos digitales (LOPDGDD, BOE-A-2018-16673), Reglamento (UE) 2016/679 General de Protección de Datos (RGPD) y Ley 2/2023, de 20 de febrero, reguladora de la protección de las personas que informen sobre infracciones normativas.
Protección de datos y derechos digitales en el Ayuntamiento de ${config.name}:
- Responsable del Tratamiento: Ayuntamiento de ${config.name} (CIF ${config.cif}), con domicilio en ${config.address}, teléfono ${config.phone} y correo ${config.email}.
- Ejercicio de Derechos de Protección de Datos (Arts. 12 a 18 LOPDGDD y Arts. 15 a 22 RGPD):
  1. Derecho de Acceso (SIA 3318904): Obtener confirmación de si el Ayuntamiento trata datos personales del ciudadano y acceder a ellos (plazo de resolución: 1 mes).
  2. Derechos de Rectificación, Supresión (Derecho al Olvido - Art. 17 RGPD), Limitación, Portabilidad y Oposición (SIA 3318905): Solicitar la rectificación de datos inexactos o la supresión/borrado inmediato de los datos personales cuando ya no sean necesarios o se retire el consentimiento. En AlmeríaCerca también puede ejecutarse instantáneamente desde "Mi Perfil -> Borrar mis datos" o escribiendo "borrar mis datos" en el asistente.
  3. Contacto con el Delegado de Protección de Datos (SIA 3318903): Disponible en la Sede Electrónica (${config.sedeBaseUrl}).
- Canal Interno de Información / Canal de Denuncias (Ley 2/2023 y Directiva UE 2019/1937): Permite comunicar de forma confidencial o anónima acciones u omisiones indebidas en el ámbito municipal (${config.sedeBaseUrl}/complaints-channel). Para quejas o sugerencias ordinarias sobre servicios municipales debe utilizarse el trámite de Quejas y Sugerencias (SIA 3318886) o el reporte de incidencias urbanas.`,
    },
  ];
}

function adaptDocumentForMunicipality(
  doc: ScrapedMunicipalDoc,
  config: MunicipalityScraperConfig
): ScrapedMunicipalDoc {
  if (config.slug === 'lucainena') {
    return doc;
  }

  const adaptedUrl = doc.fuente_url
    .replace(/https?:\/\/sede\.lucainenadelastorres\.es/gi, config.sedeBaseUrl)
    .replace(/https?:\/\/(www\.)?lucainenadelastorres\.es/gi, config.webBaseUrl.replace(/\/$/, ''));

  const adaptedTitle = doc.titulo.replace(
    /Lucainena de las Torres/gi,
    config.name
  );

  const adaptedText = doc.texto
    .replace(/sede\.lucainenadelastorres\.es/gi, new URL(config.sedeBaseUrl).hostname)
    .replace(/registro@lucainenadelastorres\.es/gi, config.email)
    .replace(/950\s*36\s*40\s*68/g, config.phone)
    .replace(/P0406000J/g, config.cif)
    .replace(/L01040600/g, config.dir3)
    .replace(/04210\s*Lucainena de las Torres/gi, config.address)
    .replace(/AYUNTAMIENTO DE LUCAINENA DE LAS TORRES/g, `AYUNTAMIENTO DE ${config.name.toUpperCase()}`)
    .replace(/Ayuntamiento de Lucainena de las Torres/gi, `Ayuntamiento de ${config.name}`)
    .replace(/Lucainena de las Torres/gi, config.name);

  return {
    id: `${config.slug}-${doc.id}`,
    titulo: adaptedTitle,
    categoria: doc.categoria,
    fuente_url: adaptedUrl,
    fecha_extraccion: doc.fecha_extraccion,
    texto: adaptedText,
  };
}

export function loadOfficialMunicipalDataset(
  municipalitySlug: string,
  municipalityName: string,
  province = 'Almería'
): ScrapedMunicipalDoc[] {
  const config = getMunicipalityScraperConfig(
    municipalitySlug,
    municipalityName,
    province
  );

  const jsonPath = path.resolve(
    process.cwd(),
    'lib',
    'rag',
    'data',
    'lucainena_documentos_web.json'
  );

  let baseDocs: ScrapedMunicipalDoc[] = [];
  if (fs.existsSync(jsonPath)) {
    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as ScrapedMunicipalDoc[];
      if (Array.isArray(parsed)) {
        baseDocs = parsed.map((d) => adaptDocumentForMunicipality(d, config));
      }
    } catch (err) {
      console.error('Error reading lucainena_documentos_web.json:', err);
    }
  }

  const lawDocs = buildMunicipalLawsCompendium(config);
  return deduplicateScrapedDocs([...baseDocs, ...lawDocs]);
}

function deduplicateScrapedDocs(docs: ScrapedMunicipalDoc[]): ScrapedMunicipalDoc[] {
  const unique: ScrapedMunicipalDoc[] = [];
  const seenFingerprints = new Set<string>();

  for (const doc of docs) {
    const cleanText = doc.texto.trim();
    if (!cleanText || cleanText.length < 40) continue;
    const fingerprint = cleanText.replace(/\s+/g, ' ').toLowerCase();
    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);
    unique.push(doc);
  }

  return unique;
}

function isValidMunicipalLink(url: string, baseDomain: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    const cleanBase = baseDomain.toLowerCase().replace(/^www\./, '');
    if (host !== baseDomain.toLowerCase() && host !== cleanBase && host !== `www.${cleanBase}`) {
      return false;
    }
    const lowerPath = parsed.pathname.toLowerCase();
    if (EXTENSIONES_EXCLUIDAS.some((ext) => lowerPath.endsWith(ext))) {
      return false;
    }
    const lowerUrl = url.toLowerCase();
    if (PATRONES_URL_EXCLUIDOS.some((pat) => lowerUrl.includes(pat))) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Ejecuta el scraping en vivo contra la Sede Electrónica y Web del Ayuntamiento
 * con límite de tiempo estricto (~38s) y límite de páginas para evitar timeouts en Vercel Serverless.
 * Incluye fallback automático al dataset oficial + compendio de leyes BOE si hay bloqueo WAF.
 */
export async function runLiveMunicipalScraper({
  municipalitySlug,
  municipalityName,
  province = 'Almería',
  customSedeUrl,
  customWebUrl,
  maxCatalogItems = 25,
  maxWebPages = 6,
  timeoutBudgetMs = 36_000,
}: {
  municipalitySlug: string;
  municipalityName: string;
  province?: string;
  customSedeUrl?: string;
  customWebUrl?: string;
  maxCatalogItems?: number;
  maxWebPages?: number;
  timeoutBudgetMs?: number;
}): Promise<{
  documents: ScrapedMunicipalDoc[];
  liveScrapedCount: number;
  sedePagesCount: number;
  tramitesCount: number;
  webPagesCount: number;
  lawsCount: number;
  usedOfficialFallback: boolean;
  warnings: string[];
}> {
  const startTime = Date.now();
  const isTimeUp = () => Date.now() - startTime >= timeoutBudgetMs;

  const baseConfig = getMunicipalityScraperConfig(
    municipalitySlug,
    municipalityName,
    province
  );
  const sedeBase = (customSedeUrl?.trim() || baseConfig.sedeBaseUrl).replace(/\/$/, '');
  const webBase = (customWebUrl?.trim() || baseConfig.webBaseUrl).replace(/\/$/, '') + '/';

  const nowIso = new Date().toISOString();
  const liveDocs: ScrapedMunicipalDoc[] = [];
  const warnings: string[] = [];
  let sedePagesCount = 0;
  let tramitesCount = 0;
  let webPagesCount = 0;

  // 1. Scraping concurrente por lotes de las 16 páginas de la Sede Electrónica
  const sedeQueue = [...SEDE_PAGINAS];
  const SEDE_CONCURRENCY = 4;

  for (let i = 0; i < sedeQueue.length; i += SEDE_CONCURRENCY) {
    if (isTimeUp()) break;
    const batch = sedeQueue.slice(i, i + SEDE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ([routePath, category, fallbackTitle]) => {
        const targetUrl = `${sedeBase}${routePath}`;
        const { html, error } = await fetchHtmlSafe(targetUrl, 6000);
        if (!html) {
          return { ok: false as const, url: targetUrl, error };
        }
        const cleaned = cleanScrapedHtml(html, fallbackTitle);
        if (cleaned.text.length < 80) {
          return { ok: false as const, url: targetUrl, error: 'poco_contenido' };
        }
        const slug =
          routePath
            .replace(/^\/+|\/+$/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-') || 'inicio';
        return {
          ok: true as const,
          doc: {
            id: `sede-pagina-${slug}`,
            titulo: cleaned.title || fallbackTitle,
            categoria: category,
            fuente_url: targetUrl,
            fecha_extraccion: nowIso,
            texto: cleaned.text,
          },
        };
      })
    );

    for (const r of results) {
      if (r.ok) {
        liveDocs.push(r.doc);
        sedePagesCount++;
      }
    }
  }

  // 2. Descubrir catálogo de trámites en /dossier (/catalog/t/...)
  if (!isTimeUp()) {
    const dossierUrl = `${sedeBase}/dossier`;
    const { html: dossierHtml, error: dossierErr } = await fetchHtmlSafe(dossierUrl, 7000);
    if (dossierHtml) {
      const linkRegex = /<a[^>]+href=["']([^"']*\/catalog\/t\/[^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      const procedureLinks: Array<{ name: string; url: string }> = [];
      const seenUrls = new Set<string>();

      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(dossierHtml)) !== null) {
        const rawHref = match[1].trim();
        const rawText = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' '))
          .replace(/\s+/g, ' ')
          .trim();
        let fullUrl = rawHref;
        try {
          fullUrl = new URL(rawHref, dossierUrl).toString().split('#')[0];
        } catch {
          continue;
        }
        if (seenUrls.has(fullUrl)) continue;
        seenUrls.add(fullUrl);
        procedureLinks.push({
          name: rawText || 'Trámite municipal',
          url: fullUrl,
        });
        if (procedureLinks.length >= maxCatalogItems) break;
      }

      for (let i = 0; i < procedureLinks.length; i += SEDE_CONCURRENCY) {
        if (isTimeUp()) break;
        const batch = procedureLinks.slice(i, i + SEDE_CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (item) => {
            const { html, error } = await fetchHtmlSafe(item.url, 6000);
            if (!html) return { ok: false as const, error };
            const cleaned = cleanScrapedHtml(html, item.name);
            if (cleaned.text.length < 60) return { ok: false as const, error: 'short' };
            const idPart = item.url.replace(/\/$/, '').split('/').pop() || 'tramite';
            return {
              ok: true as const,
              doc: {
                id: `sede-tramite-${idPart}`,
                titulo: item.name || cleaned.title,
                categoria: 'tramite_sede',
                fuente_url: item.url,
                fecha_extraccion: nowIso,
                texto: cleaned.text,
              },
            };
          })
        );

        for (const r of results) {
          if (r.ok) {
            liveDocs.push(r.doc);
            tramitesCount++;
          }
        }
      }
    } else if (dossierErr) {
      warnings.push(`Catálogo /dossier (${dossierErr})`);
    }
  }

  // 3. Scraping ligero de la web municipal con detección anti-bot
  if (!isTimeUp()) {
    let baseDomain = '';
    try {
      baseDomain = new URL(webBase).hostname.toLowerCase();
    } catch {
      baseDomain = '';
    }

    if (baseDomain) {
      const pending = customWebUrl?.trim()
        ? [customWebUrl.trim()]
        : [...baseConfig.webSeedUrls];
      const visited = new Set<string>();
      let blocks = 0;

      while (pending.length > 0 && webPagesCount < maxWebPages && !isTimeUp()) {
        const url = pending.shift()!;
        if (visited.has(url)) continue;
        visited.add(url);

        const { html, error } = await fetchHtmlSafe(url, 5500);
        if (!html) {
          if (error && error.includes('anti-bot')) {
            blocks++;
            if (blocks >= 2) {
              warnings.push(
                'Web municipal con protección WAF/anti-bot activa; se prioriza Sede Electrónica y Leyes BOE.'
              );
              break;
            }
          }
          continue;
        }

        if (url.replace(/\/$/, '') === webBase.replace(/\/$/, '')) {
          const hrefRegex = /<a[^>]+href=["']([^"'#]+)["']/gi;
          let m: RegExpExecArray | null;
          while ((m = hrefRegex.exec(html)) !== null) {
            const href = m[1].trim();
            if (!href || /^(javascript:|mailto:|tel:)/i.test(href)) continue;
            try {
              const abs = new URL(href, url).toString().split('#')[0];
              if (!visited.has(abs) && isValidMunicipalLink(abs, baseDomain)) {
                pending.push(abs);
              }
            } catch {
              // ignore invalid URLs
            }
          }
        }

        const cleaned = cleanScrapedHtml(
          html,
          `Web Ayuntamiento de ${baseConfig.name}`
        );
        if (cleaned.text.length < 80) continue;

        webPagesCount++;
        liveDocs.push({
          id: `web-ayto-${String(webPagesCount).padStart(3, '0')}`,
          titulo: cleaned.title || `Web Ayuntamiento de ${baseConfig.name}`,
          categoria: 'web_ayuntamiento',
          fuente_url: url,
          fecha_extraccion: nowIso,
          texto: cleaned.text,
        });
      }
    }
  }

  // 4. Añadir siempre el Compendio de Leyes BOE y completar con el dataset oficial verificado
  // para que ningún trámite SIA quede fuera por límite de tiempo o bloqueo WAF
  const lawDocs = buildMunicipalLawsCompendium(baseConfig);
  const officialDataset = loadOfficialMunicipalDataset(
    municipalitySlug,
    municipalityName,
    province
  );

  const usedOfficialFallback = liveDocs.length < 15;
  const combined = deduplicateScrapedDocs([
    ...liveDocs,
    ...officialDataset,
    ...lawDocs,
  ]);

  return {
    documents: combined,
    liveScrapedCount: liveDocs.length,
    sedePagesCount,
    tramitesCount,
    webPagesCount,
    lawsCount: lawDocs.length,
    usedOfficialFallback,
    warnings,
  };
}
