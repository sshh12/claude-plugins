import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';

const PAPER_SIZES: Record<string, { width: number; height: number }> = {
  letter: { width: 8.5, height: 11 },
  a4: { width: 8.27, height: 11.69 },
  legal: { width: 8.5, height: 14 },
  tabloid: { width: 11, height: 17 },
};

export async function handlePdf(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    output?: string;
    landscape?: boolean;
    printBackground?: boolean;
    scale?: number;
    paper?: string;
    tab?: string;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  const paperSize = PAPER_SIZES[params.paper || 'letter'] || PAPER_SIZES.letter;
  const scale = Math.min(Math.max(params.scale || 1, 0.1), 2.0);

  const pdfOptions: any = {
    landscape: params.landscape || false,
    printBackground: params.printBackground !== false, // default true
    scale,
    paperWidth: paperSize.width,
    paperHeight: paperSize.height,
    marginTop: 0.4,
    marginBottom: 0.4,
    marginLeft: 0.4,
    marginRight: 0.4,
  };

  const { data } = await client.Page.printToPDF(pdfOptions);
  const buffer = Buffer.from(data, 'base64');

  // Determine output path
  const outputDir = config.screenshotDir;
  mkdirSync(outputDir, { recursive: true });
  const outputPath = params.output || join(outputDir, `${Date.now()}.pdf`);

  writeFileSync(outputPath, buffer);

  return { ok: true, path: outputPath };
}
