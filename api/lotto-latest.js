// api/lotto-latest.js
// 최신 회차를 빠르게 찾아서 반환
// 날짜 계산으로 예상 회차를 구한 뒤 병렬 요청 → 타임아웃 없음

export const config = {
  runtime: 'edge',
};

const LOTTO_API = 'https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=';

async function fetchRound(round) {
  try {
    const res = await fetch(`${LOTTO_API}${round}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LottoProxy/1.0)',
        'Referer': 'https://www.dhlottery.co.kr',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (d.returnValue !== 'success') return null;
    return {
      latestRound: d.drwNo,
      date: d.drwNoDate,
      nums: [d.drwtNo1, d.drwtNo2, d.drwtNo3, d.drwtNo4, d.drwtNo5, d.drwtNo6],
      bonus: d.bnusNo,
      prize1: d.firstWinamnt,
      cnt1: d.firstPrzwnerCo,
    };
  } catch {
    return null;
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

  // 예상 회차 ±3 범위를 동시에 병렬 요청
  const candidates = [
    estimatedRound + 2,
    estimatedRound + 1,
    estimatedRound,
    estimatedRound - 1,
    estimatedRound - 2,
    estimatedRound - 3,
  ];

  const results = await Promise.all(candidates.map(r => fetchRound(r)));
  const valid = results.filter(Boolean).sort((a, b) => b.latestRound - a.latestRound);

  if (!valid.length) {
    return jsonResponse({ error: '최신 회차를 찾을 수 없습니다' }, 500);
  }

  return jsonResponse(valid[0], 200, 1800);
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