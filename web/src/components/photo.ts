// Сжимает выбранное фото до квадрата 160×160 JPEG (~8–15 КБ) прямо в телефоне.
export function pickPhoto(): Promise<string | null> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      const img = new Image();
      img.onload = () => {
        const S = 160, c = document.createElement('canvas');
        c.width = S; c.height = S;
        const side = Math.min(img.width, img.height);
        c.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
        let q = 0.85, url = c.toDataURL('image/jpeg', q);
        while (url.length > 38_000 && q > 0.4) { q -= 0.1; url = c.toDataURL('image/jpeg', q); }
        URL.revokeObjectURL(img.src);
        resolve(url);
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(f);
    };
    inp.click();
  });
}
