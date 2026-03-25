import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";

const execFileAsync = promisify(execFile);

// Upload directory relative to project root
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

// Base URL for serving uploaded files
function getBaseUrl(): string {
  // In production, use the NEXTAUTH_URL or default to localhost
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  return baseUrl.replace(/\/$/, ""); // Remove trailing slash
}

/**
 * Ensure the upload directory exists
 */
async function ensureUploadDir(): Promise<void> {
  try {
    await fs.access(UPLOAD_DIR);
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  }
}

/**
 * Compress an image buffer using sharp
 */
async function compressImage(buffer: Buffer, contentType: string): Promise<Buffer> {
  if (!contentType.startsWith("image/") || contentType === "image/gif" || contentType === "image/svg+xml") {
    return buffer;
  }

  try {
    // .rotate() with no args reads EXIF orientation and corrects it, then strips the tag.
    let sharpInstance = sharp(buffer).rotate();

    if (contentType === "image/png") {
      return await sharpInstance.png({ quality: 80, compressionLevel: 9 }).toBuffer();
    } else if (contentType === "image/webp") {
      return await sharpInstance.webp({ quality: 80 }).toBuffer();
    } else {
      // Default to JPEG for others (jpg, jpeg, heic, heif via sharp if supported)
      return await sharpInstance.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    }
  } catch (error) {
    console.warn("Image compression failed, using original buffer:", error);
    return buffer;
  }
}

/**
 * Upload a file to local storage with compression for images
 */
export async function uploadFile(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  await ensureUploadDir();

  // Compress if it's an image
  let finalBuffer = buffer;
  if (contentType.startsWith("image/")) {
    finalBuffer = await compressImage(buffer, contentType);
  }

  // Sanitize filename and create a unique path
  const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  const filePath = path.join(UPLOAD_DIR, safeFilename);

  // Write the file
  await fs.writeFile(filePath, finalBuffer);

  // Return the relative URL (works regardless of host)
  return `/uploads/${safeFilename}`;
}

/**
 * Upload a file with a size limit check
 * Returns URL and the processed buffer
 */
export async function uploadFileWithLimit(
  buffer: Buffer,
  filename: string,
  contentType: string,
  limitBytes: number
): Promise<{ url: string; buffer: Buffer }> {
  // Compress first to see if it fits
  let finalBuffer = buffer;
  if (contentType.startsWith("image/")) {
    finalBuffer = await compressImage(buffer, contentType);
  }

  if (finalBuffer.length > limitBytes) {
    const limitMb = (limitBytes / (1024 * 1024)).toFixed(0);
    throw new Error(`File size exceeds your plan limit of ${limitMb}MB`);
  }
  
  // Save the file (duplicating uploadFile logic to avoid re-compression)
  await ensureUploadDir();

  // Sanitize filename and create a unique path
  const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  const filePath = path.join(UPLOAD_DIR, safeFilename);

  // Write the file
  await fs.writeFile(filePath, finalBuffer);

  // Return the relative URL (works regardless of host) and the buffer
  return { url: `/uploads/${safeFilename}`, buffer: finalBuffer };
}

/**
 * Upload multiple files to local storage
 */
export async function uploadFiles(
  files: { buffer: Buffer; filename: string; contentType: string }[]
): Promise<string[]> {
  const urls = await Promise.all(
    files.map((file) => uploadFile(file.buffer, file.filename, file.contentType))
  );
  return urls;
}

/**
 * Delete a file from local storage
 */
export async function deleteFile(url: string): Promise<void> {
  try {
    let filename: string;

    // Handle relative URLs
    if (url.startsWith("/uploads/")) {
      filename = path.basename(url);
    } else {
      // Extract filename from full URL
      const urlObj = new URL(url);
      filename = path.basename(urlObj.pathname);
    }

    const filePath = path.join(UPLOAD_DIR, filename);
    await fs.unlink(filePath);
  } catch (error) {
    console.warn("Failed to delete file:", error);
    // Don't throw - file might not exist
  }
}

/**
 * Delete multiple files from local storage
 */
export async function deleteFiles(urls: string[]): Promise<void> {
  await Promise.all(urls.map((url) => deleteFile(url)));
}

/**
 * Generate a unique filename with timestamp
 */
export function generateFilename(
  prefix: string,
  originalName: string,
  index?: number
): string {
  const ext = originalName.substring(originalName.lastIndexOf(".")) || ".bin";
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const suffix = index !== undefined ? `-${index}` : "";
  // Replace slashes with underscores to create flat filename
  const safePrefix = prefix.replace(/\//g, "_");
  return `${safePrefix}-${timestamp}-${random}${suffix}${ext}`;
}

/**
 * Get file buffer from local storage or URL
 */
export async function getFileBuffer(url: string): Promise<Buffer> {
  // Handle relative URLs (local uploads)
  if (url.startsWith("/uploads/")) {
    const filename = path.basename(url);
    const filePath = path.join(UPLOAD_DIR, filename);
    return await fs.readFile(filePath);
  }

  // Handle full URLs
  try {
    const urlObj = new URL(url);
    // Check if it's a local file path
    if (urlObj.pathname.startsWith("/uploads/")) {
      const filename = path.basename(urlObj.pathname);
      const filePath = path.join(UPLOAD_DIR, filename);
      return await fs.readFile(filePath);
    }
  } catch {
    // Not a valid URL, might be a relative path
  }

  // For remote URLs, fetch the file
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${url}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Convert a Word document (.doc/.docx) to PDF using LibreOffice.
 * Saves the PDF to the uploads directory and returns the relative URL.
 * This runs in the background and should not block OCR.
 */
export async function convertDocToPdf(docUrl: string): Promise<string | null> {
  try {
    // Resolve the source file path
    let srcPath: string;
    if (docUrl.startsWith("/uploads/")) {
      const filename = path.basename(docUrl);
      srcPath = path.join(UPLOAD_DIR, filename);
    } else {
      return null;
    }

    // Check file exists
    await fs.access(srcPath);

    // Create a temp dir for the conversion output
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc2pdf-"));

    try {
      await execFileAsync("libreoffice", [
        "--headless",
        "--convert-to", "pdf",
        "--outdir", tmpDir,
        srcPath,
      ], { timeout: 30000 });

      // Find the output PDF
      const baseName = path.basename(srcPath, path.extname(srcPath));
      const pdfTmpPath = path.join(tmpDir, `${baseName}.pdf`);

      await fs.access(pdfTmpPath);

      // Move PDF to uploads directory
      await ensureUploadDir();
      const pdfFilename = path.basename(docUrl).replace(/\.(docx?|DOCx?)$/, ".pdf");
      const pdfDestPath = path.join(UPLOAD_DIR, pdfFilename);
      await fs.copyFile(pdfTmpPath, pdfDestPath);

      return `/uploads/${pdfFilename}`;
    } finally {
      // Clean up temp dir
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (error) {
    console.error("Word to PDF conversion failed:", error);
    return null;
  }
}
