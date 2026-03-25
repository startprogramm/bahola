/**
 * Rotate an image by a given angle (90, 180, 270 degrees)
 * Returns a new File object with the rotated image
 */
export async function rotateImage(
  file: File,
  angle: 90 | 180 | 270
): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }

      // Swap dimensions for 90 and 270 degree rotations
      if (angle === 90 || angle === 270) {
        canvas.width = img.height;
        canvas.height = img.width;
      } else {
        canvas.width = img.width;
        canvas.height = img.height;
      }

      // Translate and rotate
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      // Convert to blob
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Could not create blob"));
            return;
          }
          // Create new file with same name
          const rotatedFile = new File([blob], file.name, {
            type: file.type,
            lastModified: Date.now(),
          });
          resolve(rotatedFile);
        },
        file.type,
        0.95
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

/**
 * Generate a preview URL for a file
 * For HEIC/HEIF files, we need special handling as browsers don't support them natively
 */
export async function generatePreviewUrl(file: File): Promise<string> {
  // Check if it's a HEIC/HEIF file that browsers can't display natively
  const isHeic = file.type === 'image/heic' || file.type === 'image/heif' ||
    file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');

  if (isHeic) {
    // For HEIC files, try to load heic2any library dynamically
    try {
      const heic2any = (await import(/* webpackChunkName: "heic2any" */ 'heic2any')).default;
      const convertedBlob = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.8,
      }) as Blob;
      return URL.createObjectURL(convertedBlob);
    } catch {
      // If conversion fails, return a placeholder or try regular method
      console.warn('HEIC conversion failed, trying regular preview');
    }
  }

  return URL.createObjectURL(file);
}

/**
 * Check if a file is an image
 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/**
 * Check if a file is a PDF
 */
export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf";
}
