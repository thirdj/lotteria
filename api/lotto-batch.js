// api/lotto-batch.js
// Node.js Runtime

const LOTTO_API = 'https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=';

async function fetchRound(round) {
  try {
    const res = await fetch(`${LOTTO_API}${round}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': 'https://www.dhlottery.co.kr/gameResult.do?method=byWin',
      },
    });
    const text = await res.text();
    if (!res.ok) return null;
    let d;
    try { d = JSON.parse(text); } catch(e) { return null; }
    if (d.returnValue !== 'success') return null;
    return {
      round: d.drwNo,
      date: d.drwNoDate,
      nums: [d.drwtNo1, d.drwtNo2, d.drwtNo3, d.drwtNo4, d.drwtNo5, d.drwtNo6],
      bonus: d.bnusNo,
      prize1: d.firstWinamnt,
      cnt1: d.firstPrzwnerCo,
    };
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const from = parseInt(req.query.from);
  const to = parseInt(req.query.to);

  if (!from || !to || isNaN(from) || isNaN(to)) {
    return res.status(400).json({ error: 'from, to 파라미터가 필요합니다' });
  }
  if (to - from > 100) {
    return res.status(400).json({ error: '한 번에 최대 100회차까지 요청 가능합니다' });
  }

  const rounds = [];
  for (let r = to; r >= from; r--) rounds.push(r);

  const results = await Promise.allSettled(rounds.map(r => fetchRound(r)));
  const draws = results
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter(Boolean)
    .sort((a, b) => b.round - a.round);

  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
  return res.status(200).json({ draws, count: draws.length });
}
