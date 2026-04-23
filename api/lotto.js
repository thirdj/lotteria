// api/lotto.js
// Node.js Runtime

const LOTTO_API = 'https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const round = req.query.round;
  if (!round || isNaN(parseInt(round))) {
    return res.status(400).json({ error: 'round 파라미터가 필요합니다' });
  }

  try {
    const upstream = await fetch(`${LOTTO_API}${round}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': 'https://www.dhlottery.co.kr/gameResult.do?method=byWin',
      },
    });

    const text = await upstream.text();
    if (!upstream.ok) return res.status(502).json({ error: '동행복권 서버 오류' });

    let d;
    try { d = JSON.parse(text); } catch(e) {
      return res.status(502).json({ error: 'JSON 파싱 실패', preview: text.slice(0, 200) });
    }

    if (d.returnValue !== 'success') {
      return res.status(404).json({ error: '존재하지 않는 회차', round: parseInt(round) });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
    return res.status(200).json({
      round: d.drwNo,
      date: d.drwNoDate,
      nums: [d.drwtNo1, d.drwtNo2, d.drwtNo3, d.drwtNo4, d.drwtNo5, d.drwtNo6],
      bonus: d.bnusNo,
      prize1: d.firstWinamnt,
      cnt1: d.firstPrzwnerCo,
    });
  } catch(e) {
    return res.status(500).json({ error: '프록시 오류', detail: e.message });
  }
}
