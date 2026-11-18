// lib/sqlh.js — общие фрагменты SQL для триггеров.

export const NOW = '(SELECT now FROM v_now)';
export const S = (k) => `(SELECT v FROM platform_settings WHERE k = '${k}')`;

// Системные счета (служебные пользователи с отрицательными id).
export const SYS = { EMISSION: -1, FEES: -2, BURN: -3, POOL: -4 };

// Проводка BC: изменение баланса + запись в журнал с итоговым балансом.
// Нулевые суммы в журнал не пишутся.
export function post(op, user, kind, delta, token = 'NULL', ref = 'NULL') {
  return `
    UPDATE wallets SET bc = bc + (${delta}) WHERE user_id = ${user};
    INSERT INTO wallet_transactions (op_id, user_id, kind, delta, balance_after, token_id, ref_id, created_at)
      SELECT ${op}, ${user}, '${kind}', (${delta}), (SELECT bc FROM wallets WHERE user_id = ${user}), ${token}, ${ref}, ${NOW}
      WHERE (${delta}) <> 0;`;
}

export function postDiamonds(op, user, kind, delta, ref = 'NULL') {
  return `
    UPDATE wallets SET diamonds = diamonds + (${delta}) WHERE user_id = ${user};
    INSERT INTO diamonds_transactions (op_id, user_id, kind, delta, balance_after, ref_id, created_at)
      SELECT ${op}, ${user}, '${kind}', (${delta}), (SELECT diamonds FROM wallets WHERE user_id = ${user}), ${ref}, ${NOW}
      WHERE (${delta}) <> 0;`;
}

