// api/lotto.js
// Vercel Serverless Function
// 동행복권 API를 서버 사이드에서 호출 → CORS 문제 해결

export const config = {
  runtime: 'edge', // Edge Runtime: 전세계 빠른 응답
};

const LOTTO_API = 'https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=';
const CACHE_TTL = 3600; // 1시간 캐시 (초)

export default async function handler(req) {
  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  const { searchParams } = new URL(req.url);
  const round = searchParams.get('round');

  if (!round || isNaN(parseInt(round))) {
    return jsonResponse({ error: 'round 파라미터가 필요합니다' }, 400);
  }

  try {
    const upstream = await fetch(`${LOTTO_API}${round}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LottoProxy/1.0)',
        'Referer': 'https://www.dhlottery.co.kr',
      },
    });

    if (!upstream.ok) {
      return jsonResponse({ error: '동행복권 서버 오류', status: upstream.status }, 502);
    }

    const data = await upstream.json();

    if (data.returnValue !== 'success') {
      return jsonResponse({ error: '존재하지 않는 회차', round: parseInt(round) }, 404);
    }

    const result = {
      round: data.drwNo,
      date: data.drwNoDate,
      nums: [
        data.drwtNo1, data.drwtNo2, data.drwtNo3,
        data.drwtNo4, data.drwtNo5, data.drwtNo6,
      ],
      bonus: data.bnusNo,
      prize1: data.firstWinamnt,
      cnt1: data.firstPrzwnerCo,
    };

    return jsonResponse(result, 200, CACHE_TTL);
  } catch (err) {
    return jsonResponse({ error: '프록시 오류', detail: err.message }, 500);
  }
}

// ── helpers ──────────────────────────────

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
    // Vercel Edge Cache + 브라우저 캐시
    headers['Cache-Control'] = `public, s-maxage=${cacheTtl}, stale-while-revalidate=600`;
  } else {
    headers['Cache-Control'] = 'no-store';
  }

  return new Response(JSON.stringify(body), { status, headers });
}
