import type { BasicEmotion } from "../../types";

export const BASIC_EMOTIONS: {
  key: BasicEmotion;
  label: string;
  description: string;
}[] = [
  { key: "default", label: "Default", description: "Standard neutral/baseline portrait" },
  { key: "happy", label: "Happy", description: "Joyful, smiling, amused" },
  { key: "sad", label: "Sad", description: "Melancholic, sorrowful, dejected" },
  { key: "afraid", label: "Afraid", description: "Fearful, startled, panicked" },
  { key: "angry", label: "Angry", description: "Furious, irritated, hostile" },
  { key: "disgusted", label: "Disgusted", description: "Repulsed, scornful, distaste" },
  { key: "surprised", label: "Surprised", description: "Astonished, wide-eyed, alert" },
  { key: "contempt", label: "Contempt", description: "Smug, disdainful, mocking" },
];

export async function cropToSquareBlob(file: File, maxDim: number = 512): Promise<Blob> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const minSide = Math.min(img.width, img.height);
        const targetSide = Math.min(minSide, maxDim);
        canvas.width = targetSide;
        canvas.height = targetSide;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, targetSide, targetSide);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else resolve(file);
          },
          "image/webp",
          0.9
        );
      };
      img.onerror = () => resolve(file);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}
