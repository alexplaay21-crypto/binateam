// Имя игрока: VIP получают 👑 рядом с ником.
export function UserName({ u }: { u: { username?: string | null; first_name?: string | null; vip?: any; id?: number } }) {
  const name = u.username ? '@' + u.username : u.first_name || (u.id ? 'ID ' + u.id : 'Игрок');
  return <span>{name}{u.vip ? <span title="VIP" style={{ marginLeft: 3 }}>👑</span> : null}</span>;
}
