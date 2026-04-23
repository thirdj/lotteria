// api/lotto-latest.js

export const config = {
  runtime: 'edge',
};

const LOTTO_API = 'https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=';

async function fetchRound(round) {
  try {
    const res = await fetch(`${LOTTO_API}${round}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Referer': 'https://www.dhlottery.co.kr/gameResult.do?method=byWin',
      },
    });

    const text = await res.text();

    if (!res.ok) return { error: `HTTP ${res.status}`, round };

    let d;
    try { d = JSON.parse(text); } catch(e) {
      return { error: 'JSON parse fail', preview: text.slice(0, 100), round };
    }

    if (d.returnValue !== 'success') return { error: 'returnValue: ' + d.returnValue, round };

    return {
      ok: true,
      latestRound: d.drwNo,
      date: d.drwNoDate,
      nums: [d.drwtNo1, d.drwtNo2, d.drwtNo3, d.drwtNo4, d.drwtNo5, d.drwtNo6],
      bonus: d.bnusNo,
      prize1: d.firstWinamnt,
      cnt1: d.firstPrzwnerCo,
    };
  } catch(e) {
    return { error: e.message, round };
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // 날짜 계산으로 예상 최신 회차 산출 (1회 = 2002년 12월 7일)
  const startDate = new Date('2002-12-07');
  const now = new Date();
  const weeksDiff = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000));
  const estimatedRound = weeksDiff + 1;

  const candidates = [
    estimatedRound + 2,
    estimatedRound + 1,
    estimatedRound,
    estimatedRound - 1,
    estimatedRound - 2,
    estimatedRound - 3,
  ];

  const results = await Promise.all(candidates.map(r => fetchRound(r)));
  const valid = results.filter(r => r && r.ok).sort((a, b) => b.latestRound - a.latestRound);

  if (!valid.length) {
    return jsonResponse({
      error: '최신 회차를 찾을 수 없습니다',
      estimatedRound,
      debug: results,
    }, 500);
  }

  const { ok, ...data } = valid[0];
  return jsonResponse(data, 200, 1800);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(body, status = 200, cacheTtl = 0) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders() };
  if (cacheTtl > 0) {
    headers['Cache-Control'] = `public, s-maxage=${cacheTtl}, stale-while-revalidate=300`;
  }
  return new Response(JSON.stringify(body), { status, headers });
}
