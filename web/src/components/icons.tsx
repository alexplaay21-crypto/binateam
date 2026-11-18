// Иконки (обводка 1.8, скругления) — в духе sBoard.
const P: Record<string, string> = {
  home: 'M3.5 10.5 12 4l8.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-6v6H5A1.5 1.5 0 0 1 3.5 19z',
  market: 'M4 19.5V13m5.3 6.5V8m5.4 11.5V11m5.3 8.5V5M3 20.5h18',
  shop: 'M6 7.5h12l-1 12H7zM9 7.5V6a3 3 0 0 1 6 0v1.5',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7.5 8.5c.8-3.6 3.8-6 7.5-6s6.7 2.4 7.5 6',
  admin: 'M12 3.5 19 6v5.5c0 4.3-3 7.7-7 9-4-1.3-7-4.7-7-9V6zM9 12l2 2 4-4',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 2-4.2-4.2',
  photo: 'M4 7.5h3l1.5-2h7l1.5 2h3V19H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  fire: 'M12 21c-4 0-6.5-2.6-6.5-6.2 0-3.6 3-5.7 3.6-9.3 2.2 1.4 3.4 3.4 3.4 5.4 1-.6 1.6-1.7 1.8-3 2.4 1.9 4.2 4.4 4.2 7 0 3.5-2.5 6.1-6.5 6.1z',
  star: 'm12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z',
  gift: 'M4 11h16v9.5H4zM3 7.5h18V11H3zM12 7.5v13M12 7.5S10.5 3.5 8 4s-1 3.5 4 3.5zm0 0s1.5-4 4-3.5 1 3.5-4 3.5z',
  back: 'M15 5l-7 7 7 7',
};

export function Icon({ name, size }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      style={size ? { width: size, height: size } : undefined}>
      <path d={P[name]} />
    </svg>
  );
}

// Значок подтверждения (как у проверенных аккаунтов).
export function Verified() {
  return (
    <svg className="verified" viewBox="0 0 24 24" aria-label="Подтверждён">
      <path fill="var(--accent)" d="M12 1.8l2.4 1.8 3-.2.9 2.9 2.5 1.7-1 2.8 1 2.8-2.5 1.7-.9 2.9-3-.2L12 22.2l-2.4-1.8-3 .2-.9-2.9-2.5-1.7 1-2.8-1-2.8 2.5-1.7.9-2.9 3 .2z" />
      <path d="m8 12.2 2.7 2.7L16.2 9.4" fill="none" stroke="var(--on-accent)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
