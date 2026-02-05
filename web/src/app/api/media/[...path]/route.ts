import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

const MEDIA_PATH = process.env.MEDIA_PATH || "/data/media";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const filePath = path.join(MEDIA_PATH, ...segments);

  // Prevent directory traversal
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(MEDIA_PATH))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const data = await readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const contentType =
      ext === ".mp4" ? "video/mp4" :
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      ext === ".png" ? "image/png" :
      "application/octet-stream";

    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
