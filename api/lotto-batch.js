// api/lotto-batch.js
// 여러 회차를 한 번에 병렬 요청 → 초기 로드 속도 최적화

export const config = {
  runtime: 'edge',
};

const LOTTO_API = 'https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get('from');
  const toStr = searchParams.get('to');

  const from = parseInt(fromStr);
  const to = parseInt(toStr);

  if (!from || !to || isNaN(from) || isNaN(to)) {
    return jsonResponse({ error: 'from, to 파라미터가 필요합니다 (회차 번호)' }, 400);
  }

  if (to - from > 100) {
    return jsonResponse({ error: '한 번에 최대 100회차까지 요청 가능합니다' }, 400);
  }

  const rounds = [];
  for (let r = to; r >= from; r--) rounds.push(r);

  // 병렬 fetch (Edge Runtime에서 최대 동시 처리)
  const results = await Promise.allSettled(
    rounds.map(async (round) => {
      const res = await fetch(`${LOTTO_API}${round}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LottoProxy/1.0)',
          'Referer': 'https://www.dhlottery.co.kr',
        },
      });
      if (!res.ok) return null;
      const d = await res.json();
      if (d.returnValue !== 'success') return null;
      return {
        round: d.drwNo,
        date: d.drwNoDate,
        nums: [d.drwtNo1, d.drwtNo2, d.drwtNo3, d.drwtNo4, d.drwtNo5, d.drwtNo6],
        bonus: d.bnusNo,
        prize1: d.firstWinamnt,
        cnt1: d.firstPrzwnerCo,
      };
    })
  );

  const draws = results
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean)
    .sort((a, b) => b.round - a.round);

  return jsonResponse({ draws, count: draws.length }, 200, 3600);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(body, status = 200, cacheTtl = 0) {
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders(),
  };
  if (cacheTtl > 0) {
    headers['Cache-Control'] = `public, s-maxage=${cacheTtl}, stale-while-revalidate=600`;
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(JSON.stringify(body), { status, headers });
}
