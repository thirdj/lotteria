// api/lotto-batch.js — Supabase에서 범위 조회

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const from = parseInt(req.query.from);
  const to = parseInt(req.query.to);

  if (!from || !to || isNaN(from) || isNaN(to)) {
    return res.status(400).json({ error: 'from, to 파라미터가 필요합니다' });
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/lotto_draws?select=*&round=gte.${from}&round=lte.${to}&order=round.desc`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    const data = await response.json();
    const draws = data.map(d => ({
      round: d.round,
      date: d.draw_date,
      nums: [d.num1, d.num2, d.num3, d.num4, d.num5, d.num6],
      bonus: d.bonus,
      prize1: d.prize1,
      cnt1: d.winners1,
    }));

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
    return res.status(200).json({ draws, count: draws.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
