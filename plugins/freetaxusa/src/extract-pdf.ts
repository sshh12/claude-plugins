import * as fs from "fs";
import * as path from "path";

interface TextItem {
  str: string;
  transform: number[];
  hasEOL?: boolean;
}

interface PageResult {
  page: number;
  textPath: string;
  textLength: number;
  hasText: boolean;
  imagePath?: string;
}

interface Result {
  ok: boolean;
  file?: string;
  pageCount?: number;
  imageRendering?: boolean;
  pages?: PageResult[];
  error?: string;
}

function output(result: Result): never {
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    output({ ok: false, error: "Usage: extract-pdf <pdf-path> [output-dir]" });
  }

  const pdfPath = path.resolve(args[0]);
  const outputDir = args[1]
    ? path.resolve(args[1])
    : path.join(path.dirname(pdfPath), path.basename(pdfPath, path.extname(pdfPath)));

  if (!fs.existsSync(pdfPath)) {
    output({ ok: false, error: `File not found: ${pdfPath}` });
  }

  fs.mkdirSync(outputDir, { recursive: true });

  // Try to load canvas for image rendering (@napi-rs/canvas preferred, falls back to node-canvas)
  let canvasModule: any = null;
  let imageRendering = false;
  try {
    canvasModule = require("@napi-rs/canvas");
    imageRendering = true;
  } catch {
    try {
      canvasModule = require("canvas");
      imageRendering = true;
    } catch {
      // No canvas available — text-only mode
    }
  }

  // Polyfill browser globals that pdf.js needs for canvas rendering
  if (canvasModule) {
    const g = globalThis as any;
    if (!g.DOMMatrix && canvasModule.DOMMatrix) g.DOMMatrix = canvasModule.DOMMatrix;
    if (!g.ImageData && canvasModule.ImageData) g.ImageData = canvasModule.ImageData;
    if (!g.Path2D && canvasModule.Path2D) g.Path2D = canvasModule.Path2D;
  }

  // Load pdf.js — use legacy build for Node.js compatibility
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjsAny = pdfjsLib as any;

  // Point workerSrc to the worker file copied alongside the bundle
  if (pdfjsAny.GlobalWorkerOptions) {
    pdfjsAny.GlobalWorkerOptions.workerSrc = path.join(__dirname, "pdf.worker.mjs");
  }

  // Resolve pdfjs-dist resource paths — pdf.js needs file:// URLs in Node
  const pdfjsDistDir = path.resolve(__dirname, "..", "..", "..", "node_modules", "pdfjs-dist");
  const toFileUrl = (p: string) => "file://" + p + "/";
  const standardFontDataUrl = fs.existsSync(path.join(pdfjsDistDir, "standard_fonts"))
    ? toFileUrl(path.join(pdfjsDistDir, "standard_fonts"))
    : undefined;
  const cMapUrl = fs.existsSync(path.join(pdfjsDistDir, "cmaps"))
    ? toFileUrl(path.join(pdfjsDistDir, "cmaps"))
    : undefined;

  // Create a custom CanvasFactory CLASS to override pdf.js's NodeCanvasFactory.
  // pdf.js's built-in NodeCanvasFactory._createCanvas uses createRequire(import.meta.url)
  // which fails in esbuild CJS bundles (import.meta.url is undefined).
  // getDocument expects a CanvasFactory CLASS (capital C), not an instance.
  let CustomCanvasFactory: any = undefined;
  if (imageRendering && canvasModule) {
    CustomCanvasFactory = class {
      _createCanvas(width: number, height: number) {
        return canvasModule.createCanvas(width, height);
      }
      create(width: number, height: number) {
        const canvas = this._createCanvas(width, height);
        return { canvas, context: canvas.getContext("2d") };
      }
      reset(canvasAndCtx: any, width: number, height: number) {
        canvasAndCtx.canvas.width = width;
        canvasAndCtx.canvas.height = height;
      }
      destroy(canvasAndCtx: any) {
        canvasAndCtx.canvas.width = 0;
        canvasAndCtx.canvas.height = 0;
      }
    };
  }

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsAny.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
    ...(cMapUrl ? { cMapUrl, cMapPacked: true } : {}),
    ...(CustomCanvasFactory ? { CanvasFactory: CustomCanvasFactory } : {}),
  }).promise;

  const pages: PageResult[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);

    // Extract text
    const textContent = await page.getTextContent();
    const textLines: string[] = [];
    let lastY: number | null = null;

    for (const item of textContent.items as TextItem[]) {
      if (!item.str && !item.hasEOL) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        textLines.push("\n");
      }
      textLines.push(item.str);
      if (item.hasEOL) {
        textLines.push("\n");
      } else {
        textLines.push(" ");
      }
      lastY = y;
    }

    const text = textLines.join("").trim();
    const textPath = path.join(outputDir, `page-${i}.txt`);
    fs.writeFileSync(textPath, text);

    const pageInfo: PageResult = {
      page: i,
      textPath,
      textLength: text.length,
      hasText: text.length > 0,
    };

    // Render to PNG if canvas available
    if (imageRendering && canvasModule) {
      try {
        const viewport = page.getViewport({ scale: 2 });
        const width = Math.floor(viewport.width);
        const height = Math.floor(viewport.height);
        const canvas = canvasModule.createCanvas(width, height);
        const context = canvas.getContext("2d");

        await page.render({
          canvasContext: context,
          viewport,
        }).promise;

        // Use canvas.toBuffer if available (@napi-rs/canvas), otherwise fall back to getImageData + pngjs
        const imagePath = path.join(outputDir, `page-${i}.png`);
        if (typeof canvas.toBuffer === "function") {
          const pngBuffer = canvas.toBuffer("image/png");
          fs.writeFileSync(imagePath, pngBuffer);
        } else {
          const { PNG } = await import("pngjs");
          const imageData = context.getImageData(0, 0, width, height);
          const png = new PNG({ width, height });
          png.data = Buffer.from(imageData.data.buffer);
          fs.writeFileSync(imagePath, PNG.sync.write(png));
        }
        pageInfo.imagePath = imagePath;
      } catch (e: any) {
        process.stderr.write(`Warning: PNG render failed on page ${i}: ${e.message || e}\n`);
        // If rendering fails on first page, disable for all subsequent pages
        if (i === 1) {
          imageRendering = false;
        }
      }
    }

    pages.push(pageInfo);
    page.cleanup();
  }

  // Write summary.json
  const summary = {
    file: pdfPath,
    pageCount: doc.numPages,
    imageRendering,
    pages,
  };
  fs.writeFileSync(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));

  // Output to stdout
  console.log(JSON.stringify({ ok: true, ...summary }));

  doc.destroy();
  process.exit(0);
}

main().catch((e) => {
  output({ ok: false, error: String(e) });
});
