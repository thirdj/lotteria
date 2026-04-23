// api/lotto.js — Supabase에서 단일 회차 조회

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const round = parseInt(req.query.round);
  if (!round || isNaN(round)) {
    return res.status(400).json({ error: 'round 파라미터가 필요합니다' });
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/lotto_draws?select=*&round=eq.${round}`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    const data = await response.json();
    if (!data.length) return res.status(404).json({ error: '해당 회차 없음', round });

    const d = data[0];
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
    return res.status(200).json({
      round: d.round,
      date: d.draw_date,
      nums: [d.num1, d.num2, d.num3, d.num4, d.num5, d.num6],
      bonus: d.bonus,
      prize1: d.prize1,
      cnt1: d.winners1,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
