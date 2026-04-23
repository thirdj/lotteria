// api/lotto-latest.js
// 현재 최신 회차 번호를 찾아서 반환
// Binary search로 빠르게 탐색

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
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.returnValue === 'success' ? d.drwNo : null;
  } catch {
    return null;
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // 2025년 기준 약 1150회 → 넉넉하게 1100~1300 범위에서 탐색
  let lo = 1100;
  let hi = 1300;

  // hi 경계 확장: hi가 존재하면 더 올림
  while (await fetchRound(hi) !== null) {
    lo = hi;
    hi += 50;
  }

  // binary search
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    const result = await fetchRound(mid);
    if (result !== null) lo = mid;
    else hi = mid;
  }

  const latestRound = lo;
  const latestData = await fetchRound(latestRound);

  if (!latestData) {
    return jsonResponse({ error: '최신 회차를 찾을 수 없습니다' }, 500);
  }

  // 최신 회차 상세도 함께 반환
  const res = await fetch(`${LOTTO_API}${latestRound}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.dhlottery.co.kr' },
  });
  const d = await res.json();

  return jsonResponse(
    {
      latestRound,
      date: d.drwNoDate,
      nums: [d.drwtNo1, d.drwtNo2, d.drwtNo3, d.drwtNo4, d.drwtNo5, d.drwtNo6],
      bonus: d.bnusNo,
      prize1: d.firstWinamnt,
      cnt1: d.firstPrzwnerCo,
    },
    200,
    1800 // 30분 캐시 (새 회차 반영 고려)
  );
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
