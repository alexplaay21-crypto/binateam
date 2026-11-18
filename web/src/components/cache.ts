// Последние данные экранов в памяти: открытый ранее токен показывается мгновенно,
// а свежие данные подтягиваются в фоне.
const mem = new Map<string, any>();
export const cache = {
  get: (k: string) => mem.get(k),
  set: (k: string, v: any) => { mem.set(k, v); if (mem.size > 40) mem.delete(mem.keys().next().value as string); },
};
