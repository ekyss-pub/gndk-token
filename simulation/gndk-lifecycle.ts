/* eslint-disable */
declare var console: any;

// ═══════════════════════════════════════════════════════════════
// GNDK 토큰 라이프사이클 시뮬레이션 (5년, 월 단위)
// ═══════════════════════════════════════════════════════════════
//
// 목적: GNDK 토크노믹스가 12개월 수강권 구조에서도
//       He/She 코스메틱 + 라이브 클래스룸 등 소비처를 통해
//       장기 지속 가능한지 수치 검증
//
// 사양: EKYSS_L2E_TOKENOMICS_SOLANA.md v2.5.4-sol
//
// 실행: npx ts-node --project simulation/tsconfig.json simulation/gndk-lifecycle.ts
//
// ═══════════════════════════════════════════════════════════════

// ─── 토큰 기본 설정 (사양서 Section 3.2) ───
const TOTAL_SUPPLY    = 1_000_000_000;  // 10억 GNDK (고정)
const REWARD_POOL     =   300_000_000;  // 30% 생태계 보상 (L2E + Creator)
const FOUNDATION      =   250_000_000;  // 25% 재단 (즉시 해제)
const DONATION        =    50_000_000;  // 5% 기부/사회공헌
const EARLY_CONTRIB   =   100_000_000;  // 10% 초기 기여자 (1년 lock + 1년 linear)
const PRIVATE_SALE    =   100_000_000;  // 10% 프라이빗 세일 (1년 lock + 1년 linear)
const TEAM_ADVISOR    =    50_000_000;  // 5% 팀/어드바이저 (1년 lock + 2년 linear)
const MARKETING       =   100_000_000;  // 10% 마케팅
const PARTNERSHIP     =    50_000_000;  // 5% 파트너십

const BURN_RATIO = 0.5;  // BurnRecycle: 50% 영구 소각, 50% 풀 리사이클

// ─── Dynamic Halving (사양서 Section 4.6) ───
// Phase별 인당 연간 최대 GNDK
function getAnnualCap(totalUsers: number): { phase: number; cap: number } {
  if (totalUsers < 100_000)       return { phase: 1, cap: 70 };
  if (totalUsers < 1_000_000)     return { phase: 2, cap: 40 };
  if (totalUsers < 10_000_000)    return { phase: 3, cap: 15 };
  return { phase: 4, cap: 3 };
}

// ─── 시뮬레이션 기간 ───
const MONTHS = 60; // 5년

// ═══════════════════════════════════════════════════════════════
// 포인트 전환 임계값 모델 (사양서 Section 4.4)
// ═══════════════════════════════════════════════════════════════
//
// ─── 실제 앱 포인트 규칙 (MYPOOL/GANADARA) ───
//
// 일일 획득 캡: 100pt
//
// | 활동        | 포인트   | 최대     | 비고           |
// |-------------|---------|---------|----------------|
// | 룰렛        | 2~30    | 1회     | 평균 ~14pt     |
// | 퀴즈 풀이   | 5pt/set | 3회=15  |                |
// | 출석        | 5pt     | 고정    |                |
// | 게시글 작성 | 5pt     | 3회=15  |                |
// | 게시글 댓글 | -       | 6pt     |                |
// | 좋아요      | -       | 5pt     |                |
// | 강의 시청   | 5pt     | 5회=25  |                |
// | 후원하기    | 30pt    | 1회     | 유료 기능      |
// | 이론 최대   | ~115pt  | →100pt  | 일일 캡 적용   |
//
// ─── 유저 타입별 월간 포인트 추정 ───
//
// [유료 구독자] — 돈 내고 공부하는 유저, 동기부여 높음
//   헤비(5%):   ~80pt/일 × 28일 = ~2,200pt/월
//   활발(15%):  ~55pt/일 × 22일 = ~1,200pt/월
//   보통(30%):  ~40pt/일 × 15일 = ~600pt/월
//   라이트(25%):~25pt/일 × 8일  = ~200pt/월
//   거의안함(25%):~15pt/일 × 3일 = ~45pt/월
//   → 가중 평균: ~620pt/월
//
// [무료 유저] — 체험/간헐적 학습, 동기 낮음
//   헤비(5%):   ~60pt/일 × 20일 = ~1,200pt/월 (후원 없음)
//   활발(15%):  ~35pt/일 × 12일 = ~420pt/월
//   보통(30%):  ~20pt/일 × 6일  = ~120pt/월
//   라이트(25%):~12pt/일 × 3일  = ~36pt/월
//   거의안함(25%):~5pt/일 × 1일 = ~5pt/월
//   → 가중 평균: ~185pt/월
//
// ═══════════════════════════════════════════════════════════════

interface PointThresholdConfig {
  // 전환 임계값 (포인트) — 이만큼 모아야 GNDK 교환 가능
  conversionThreshold: number;
  // 포인트 소멸 기간 (월) — 이 기간 내 임계값 미도달 시 소멸
  expiryMonths: number;
  // 유료 유저 월간 평균 포인트 획득량
  paidMonthlyPoints: number;
  // 무료 유저 월간 평균 포인트 획득량
  freeMonthlyPoints: number;
}

// 유저 활동량 분포 시뮬레이션 (파레토 근사)
// 실제 앱 데이터 기반 5-tier 모델
// 반환: 임계값 도달률 (0~1)
function calcThresholdReachRate(
  monthlyPoints: number,
  threshold: number,
  expiryMonths: number,
): number {
  // 유저 활동 분포 (5-tier):
  //   평균 monthlyPoints를 중심으로 각 등급의 배수를 적용
  //   배수는 실제 앱 포인트 추정치에서 역산
  //
  // [유료 기준 monthlyPoints=620]
  //   헤비(5%):  ×3.5 = 2,170pt   ← 실측 ~2,200
  //   활발(15%): ×1.9 = 1,178pt   ← 실측 ~1,200
  //   보통(30%): ×1.0 = 620pt     ← 실측 ~600
  //   라이트(25%): ×0.32 = 198pt  ← 실측 ~200
  //   거의안함(25%): ×0.07 = 43pt ← 실측 ~45
  //
  // [무료 기준 monthlyPoints=185]
  //   헤비(5%):  ×6.5 = 1,202pt   ← 실측 ~1,200
  //   활발(15%): ×2.3 = 425pt     ← 실측 ~420
  //   보통(30%): ×0.65 = 120pt    ← 실측 ~120
  //   라이트(25%): ×0.19 = 35pt   ← 실측 ~36
  //   거의안함(25%): ×0.03 = 5pt  ← 실측 ~5

  const tiers = [
    { pct: 0.05, multiplier: 3.5 },   // 상위 5%: 헤비 유저
    { pct: 0.15, multiplier: 1.9 },   // 다음 15%: 활발 유저
    { pct: 0.30, multiplier: 1.0 },   // 중간 30%: 보통 유저
    { pct: 0.25, multiplier: 0.32 },  // 하위 25%: 라이트 유저
    { pct: 0.25, multiplier: 0.07 },  // 최하위 25%: 거의 안 함
  ];

  let reachRate = 0;
  for (const tier of tiers) {
    const accumulatedPoints = monthlyPoints * tier.multiplier * expiryMonths;
    if (accumulatedPoints >= threshold) {
      reachRate += tier.pct;
    } else {
      // 부분 도달 — 비선형 감쇠 (간신히 못 모은 유저 반영)
      const partialRate = accumulatedPoints / threshold;
      reachRate += tier.pct * Math.pow(partialRate, 2);
    }
  }

  return Math.min(1, reachRate);
}

// ═══════════════════════════════════════════════════════════════
// 시나리오 정의
// ═══════════════════════════════════════════════════════════════

interface GNDKScenario {
  name: string;
  description: string;

  // ─── 유저 성장 ───
  totalMAU: (month: number) => number;
  paidRatio: (month: number) => number;

  // ─── L2E 보상 ───
  freeUsersEarnL2E: boolean;
  // 레거시 모델 (threshold 없을 때)
  freeL2EParticipation: number;
  paidL2EParticipation: number;

  // ─── 포인트 전환 임계값 (Section 4.4) ───
  // null이면 레거시 참여율 모델 사용
  pointThreshold: PointThresholdConfig | null;

  // ─── 수익 (Burn 소스) ───
  subscriptionPrice: number;
  renewalRate: number;
  heSheSpending: (month: number) => number;
  liveClassSpending: (month: number) => number;
  premiumSpending: (month: number) => number;

  // ─── D2E B2B 매출 (월, USD) ───
  d2eRevenue: (month: number) => number;

  // ─── 크리에이터 보상 (월, 전체 GNDK) ───
  creatorRewards: (month: number) => number;
}

// ── 구독 BurnRecycle 계산 ──
// 유료 전환 유저 = 이번 달 유료 유저 증가분 (신규 결제)
// 12개월 후 일부 갱신
// paidHistory: 월별 유료 유저 수 기록 (갱신 계산용)
const paidHistory: number[] = [];

function calcSubscriptionBurn(
  month: number,
  scenario: GNDKScenario,
): number {
  const mau = scenario.totalMAU(month);
  const paidUsers = Math.round(mau * scenario.paidRatio(month));
  const prevPaid = paidHistory.length > 0 ? paidHistory[paidHistory.length - 1] : 0;
  paidHistory.push(paidUsers);

  // 신규 유료 전환자 (이번 달 유료 - 지난 달 유료, 양수만)
  const newPaid = Math.max(0, paidUsers - prevPaid);
  let subscriptionGndk = newPaid * scenario.subscriptionPrice;

  // 12개월 전 유료 전환자들의 갱신
  if (month > 12 && paidHistory.length > 12) {
    const paidThen = paidHistory[paidHistory.length - 13] || 0;
    const paidBefore = paidHistory.length > 13 ? (paidHistory[paidHistory.length - 14] || 0) : 0;
    const newPaidThen = Math.max(0, paidThen - paidBefore);
    const renewals = newPaidThen * scenario.renewalRate;
    subscriptionGndk += renewals * scenario.subscriptionPrice;
  }

  return subscriptionGndk;
}

// ═══════════════════════════════════════════════════════════════
// 시나리오들
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 시나리오 설계 핵심 전제 (v3 — 현실적 전환율 반영):
//
// 1. 무료 유저가 기본 (교육 앱 특성상 무료 체험 필수)
// 2. 유료 전환율: 업계 현실 4~7%, 좋으면 10%
// 3. 무료 유저도 활동 포인트 → GNDK 교환 가능 (L2E)
// 4. He/She + LiveClassroom + Creator = 풀스펙 소비처
// 5. 이 서비스들이 갖춰지는 시기가 생사를 가름
//
// ═══════════════════════════════════════════════════════════════

const scenarios: GNDKScenario[] = [
  // ── A. 현실 기본: 전환율 7%, 소비처 없음 (TGE 직후) ──
  {
    name: "🔴 A. TGE 직후 (전환7%, 소비처 없음)",
    description: "MAU 10만, 유료7%, 수강권만 — He/She 아직 없음",
    totalMAU: (m) => Math.min(5_000 + m * 3_000, 100_000),
    paidRatio: (_m) => 0.07,
    freeUsersEarnL2E: true,
    freeL2EParticipation: 0.5,
    paidL2EParticipation: 0.8,
    pointThreshold: null,
    subscriptionPrice: 120,
    renewalRate: 0.4,
    heSheSpending: (_m) => 0,
    liveClassSpending: (_m) => 0,
    premiumSpending: (_m) => 0,
    d2eRevenue: (_m) => 0,
    creatorRewards: (m) => m < 6 ? 0 : Math.min(500 + m * 100, 10_000),
  },

  // ── B. 전환율 7%, He/She 6개월차 출시 ──
  {
    name: "🟡 B. He/She 6M 출시 (전환7%)",
    description: "MAU 10만, 유료7%, He/She 6M부터 $5/m, 라이브 12M부터",
    totalMAU: (m) => Math.min(5_000 + m * 3_000, 100_000),
    paidRatio: (m) => m < 6 ? 0.07 : m < 12 ? 0.08 : m < 24 ? 0.09 : 0.10,
    freeUsersEarnL2E: true,
    freeL2EParticipation: 0.5,
    paidL2EParticipation: 0.8,
    pointThreshold: null,
    subscriptionPrice: 120,
    renewalRate: 0.4,
    // He/She: 6개월차 출시, 유료 유저만 구매
    heSheSpending: (m) => m < 6 ? 0 : m < 12 ? 3 : m < 24 ? 5 : 7,
    // 라이브: 12개월차 출시
    liveClassSpending: (m) => m < 12 ? 0 : m < 24 ? 2 : 3,
    premiumSpending: (m) => m < 12 ? 0 : 2,
    d2eRevenue: (m) => m < 24 ? 0 : m < 36 ? 5_000 : 20_000,
    creatorRewards: (m) => m < 6 ? 0 : Math.min(500 + m * 100, 10_000),
  },

  // ── C. 풀스펙 (He/She + Live + Creator) 12개월차 완비, 전환 10% ──
  {
    name: "🟢 C. 풀스펙 12M 완비 (전환10%)",
    description: "MAU 15만, 전환10%, He/She$8~15, 라이브$5, 크리에이터 활성",
    totalMAU: (m) => Math.min(5_000 + m * 3_000, 150_000),
    paidRatio: (m) => m < 6 ? 0.07 : m < 12 ? 0.08 : m < 18 ? 0.09 : 0.10,
    freeUsersEarnL2E: true,
    freeL2EParticipation: 0.5,
    paidL2EParticipation: 0.8,
    pointThreshold: null,
    subscriptionPrice: 120,
    renewalRate: 0.45,
    heSheSpending: (m) => m < 6 ? 0 : m < 12 ? 3 : m < 24 ? 8 : 15,
    liveClassSpending: (m) => m < 12 ? 0 : m < 24 ? 3 : 5,
    premiumSpending: (m) => m < 12 ? 0 : 3,
    d2eRevenue: (m) => m < 18 ? 0 : m < 36 ? 10_000 : 50_000,
    creatorRewards: (m) => m < 12 ? 0 : Math.min(1_000 + m * 200, 20_000),
  },

  // ── D. 풀스펙 늦음 (24개월차 완비) ──
  {
    name: "🟠 D. 풀스펙 늦음 24M (전환7%)",
    description: "MAU 15만, 전환7%, He/She 12M, 라이브 24M 출시",
    totalMAU: (m) => Math.min(5_000 + m * 3_000, 150_000),
    paidRatio: (m) => m < 12 ? 0.07 : m < 24 ? 0.08 : 0.09,
    freeUsersEarnL2E: true,
    freeL2EParticipation: 0.5,
    paidL2EParticipation: 0.8,
    pointThreshold: null,
    subscriptionPrice: 120,
    renewalRate: 0.35,
    heSheSpending: (m) => m < 12 ? 0 : m < 24 ? 3 : m < 36 ? 5 : 8,
    liveClassSpending: (m) => m < 24 ? 0 : m < 36 ? 2 : 3,
    premiumSpending: (m) => m < 24 ? 0 : 2,
    d2eRevenue: (m) => m < 36 ? 0 : 10_000,
    creatorRewards: (m) => m < 12 ? 0 : Math.min(500 + m * 100, 10_000),
  },

  // ── E. 유저 폭증 + 전환율 5% ──
  {
    name: "💀 E. 유저 폭증 MAU 50만 (전환5%)",
    description: "MAU 50만, 전환5%, He/She$5, 라이브$3 — 급성장 스트레스",
    totalMAU: (m) => Math.min(10_000 + m * 10_000, 500_000),
    paidRatio: (_m) => 0.05,
    freeUsersEarnL2E: true,
    freeL2EParticipation: 0.5,
    paidL2EParticipation: 0.8,
    pointThreshold: null,
    subscriptionPrice: 120,
    renewalRate: 0.3,
    heSheSpending: (m) => m < 6 ? 0 : 5,
    liveClassSpending: (m) => m < 12 ? 0 : 3,
    premiumSpending: (m) => m < 12 ? 0 : 2,
    d2eRevenue: (m) => m < 18 ? 0 : m < 36 ? 10_000 : 30_000,
    creatorRewards: (m) => m < 6 ? 0 : Math.min(2_000 + m * 300, 30_000),
  },

  // ── F. 무료 L2E 한도 차등 (유료의 30%) — 방어 전략 ──
  {
    name: "📘 F. 무료 L2E 30%제한 + 풀스펙 12M (전환10%)",
    description: "무료 유저 L2E를 유료의 30%로 제한 + 풀스펙 소비처",
    totalMAU: (m) => Math.min(5_000 + m * 3_000, 150_000),
    paidRatio: (m) => m < 6 ? 0.07 : m < 12 ? 0.08 : m < 18 ? 0.09 : 0.10,
    freeUsersEarnL2E: true,
    freeL2EParticipation: 0.15,   // ← 유료(0.8)의 ~19% 수준 (한도 30% × 참여율 50%)
    paidL2EParticipation: 0.8,
    pointThreshold: null,
    subscriptionPrice: 120,
    renewalRate: 0.45,
    heSheSpending: (m) => m < 6 ? 0 : m < 12 ? 3 : m < 24 ? 8 : 15,
    liveClassSpending: (m) => m < 12 ? 0 : m < 24 ? 3 : 5,
    premiumSpending: (m) => m < 12 ? 0 : 3,
    d2eRevenue: (m) => m < 18 ? 0 : m < 36 ? 10_000 : 50_000,
    creatorRewards: (m) => m < 12 ? 0 : Math.min(1_000 + m * 200, 20_000),
  },

  // ═══════════════════════════════════════════════════════════════
  // 포인트 전환 임계값 시나리오 (Section 4.4)
  //
  // 실제 앱 포인트 규칙 반영:
  //   일일 캡: 100pt
  //   유료 평균: ~620pt/월, 무료 평균: ~185pt/월
  //
  // 기존 F(무료 L2E 하드리밋)와 달리 규칙은 모두에게 동일.
  // 자연스럽게 캐주얼 유저를 걸러냄.
  // ═══════════════════════════════════════════════════════════════

  // ── G. 임계값 500pt/3M — 유료 1개월, 무료 활발 3개월 도달 ──
  {
    name: "🔵 G. 임계값 500pt/3M + 풀스펙 12M (전환10%)",
    description: "유료 평균 1개월 도달, 무료 활발(상위20%) 3개월 도달",
    totalMAU: (m) => Math.min(5_000 + m * 3_000, 150_000),
    paidRatio: (m) => m < 6 ? 0.07 : m < 12 ? 0.08 : m < 18 ? 0.09 : 0.10,
    freeUsersEarnL2E: true,
    freeL2EParticipation: 0.5,
    paidL2EParticipation: 0.8,
    pointThreshold: {
      conversionThreshold: 500,    // 500pt — 유료 보통(620pt/m) 1개월이면 넘음
      expiryMonths: 3,             // 3개월 소멸
      paidMonthlyPoints: 620,      // 유료 평균 620pt/월
      freeMonthlyPoints: 185,      // 무료 평균 185pt/월
    },
    subscriptionPrice: 120,
    renewalRate: 0.45,
    heSheSpending: (m) => m < 6 ? 0 : m < 12 ? 3 : m < 24 ? 8 : 15,
    liveClassSpending: (m) => m < 12 ? 0 : m < 24 ? 3 : 5,
    premiumSpending: (m) => m < 12 ? 0 : 3,
    d2eRevenue: (m) => m < 18 ? 0 : m < 36 ? 10_000 : 50_000,
    creatorRewards: (m) => m < 12 ? 0 : Math.min(1_000 + m * 200, 20_000),
  },

  // ── H. 임계값 1,500pt/3M — 유료 2~3개월, 무료 상위5%만 ──
  {
    name: "🟣 H. 임계값 1500pt/3M + 풀스펙 12M (전환10%)",
    description: "유료 보통~활발 3개월 도달, 무료는 헤비(상위5%)만",
    totalMAU: (m) => Math.min(5_000 + m * 3_000, 150_000),
    paidRatio: (m) => m < 6 ? 0.07 : m < 12 ? 0.08 : m < 18 ? 0.09 : 0.10,
    freeUsersEarnL2E: true,
    freeL2EParticipation: 0.5,
    paidL2EParticipation: 0.8,
    pointThreshold: {
      conversionThreshold: 1500,   // 1,500pt — 유료 보통(620×3=1,860) 3개월에 도달
      expiryMonths: 3,             // 3개월 소멸
      paidMonthlyPoints: 620,      // 유료 평균 620pt/월
      freeMonthlyPoints: 185,      // 무료 평균 185pt/월 (3개월=555pt < 1500)
    },
    subscriptionPrice: 120,
    renewalRate: 0.45,
    heSheSpending: (m) => m < 6 ? 0 : m < 12 ? 3 : m < 24 ? 8 : 15,
    liveClassSpending: (m) => m < 12 ? 0 : m < 24 ? 3 : 5,
    premiumSpending: (m) => m < 12 ? 0 : 3,
    d2eRevenue: (m) => m < 18 ? 0 : m < 36 ? 10_000 : 50_000,
    creatorRewards: (m) => m < 12 ? 0 : Math.min(1_000 + m * 200, 20_000),
  },

  // ── I. 임계값 1,500pt/6M — 무료에게도 기회 (소멸 여유) ──
  {
    name: "⬛ I. 임계값 1500pt/6M + 풀스펙 12M (전환10%)",
    description: "H와 동일 임계값이나 소멸6개월 — 무료 활발 유저도 도달 가능",
    totalMAU: (m) => Math.min(5_000 + m * 3_000, 150_000),
    paidRatio: (m) => m < 6 ? 0.07 : m < 12 ? 0.08 : m < 18 ? 0.09 : 0.10,
    freeUsersEarnL2E: true,
    freeL2EParticipation: 0.5,
    paidL2EParticipation: 0.8,
    pointThreshold: {
      conversionThreshold: 1500,   // 1,500pt — 무료 활발(420×6=2,520) 도달 가능
      expiryMonths: 6,             // 6개월 소멸 — 무료에게 여유
      paidMonthlyPoints: 620,      // 유료 평균 620pt/월
      freeMonthlyPoints: 185,      // 무료 평균 185pt/월 (6개월=1,110 < 1500 → 보통은 미달)
    },
    subscriptionPrice: 120,
    renewalRate: 0.45,
    heSheSpending: (m) => m < 6 ? 0 : m < 12 ? 3 : m < 24 ? 8 : 15,
    liveClassSpending: (m) => m < 12 ? 0 : m < 24 ? 3 : 5,
    premiumSpending: (m) => m < 12 ? 0 : 3,
    d2eRevenue: (m) => m < 18 ? 0 : m < 36 ? 10_000 : 50_000,
    creatorRewards: (m) => m < 12 ? 0 : Math.min(1_000 + m * 200, 20_000),
  },

  // ── J. 임계값 3,000pt/6M — 높은 허들 (유료 활발만) ──
  {
    name: "🔶 J. 임계값 3000pt/6M + 풀스펙 12M (전환10%)",
    description: "높은 임계값: 유료 활발(상위20%) 3개월, 무료 헤비(5%)만",
    totalMAU: (m) => Math.min(5_000 + m * 3_000, 150_000),
    paidRatio: (m) => m < 6 ? 0.07 : m < 12 ? 0.08 : m < 18 ? 0.09 : 0.10,
    freeUsersEarnL2E: true,
    freeL2EParticipation: 0.5,
    paidL2EParticipation: 0.8,
    pointThreshold: {
      conversionThreshold: 3000,   // 3,000pt — 유료 보통(620×6=3,720) 6개월에 도달
      expiryMonths: 6,             // 6개월 소멸
      paidMonthlyPoints: 620,      // 유료 평균
      freeMonthlyPoints: 185,      // 무료 평균 (6개월=1,110 << 3000)
    },
    subscriptionPrice: 120,
    renewalRate: 0.45,
    heSheSpending: (m) => m < 6 ? 0 : m < 12 ? 3 : m < 24 ? 8 : 15,
    liveClassSpending: (m) => m < 12 ? 0 : m < 24 ? 3 : 5,
    premiumSpending: (m) => m < 12 ? 0 : 3,
    d2eRevenue: (m) => m < 18 ? 0 : m < 36 ? 10_000 : 50_000,
    creatorRewards: (m) => m < 12 ? 0 : Math.min(1_000 + m * 200, 20_000),
  },
];

// ═══════════════════════════════════════════════════════════════
// 시뮬레이션 엔진
// ═══════════════════════════════════════════════════════════════

interface MonthlySnapshot {
  month: number;
  phase: number;
  mau: number;
  paidUsers: number;
  freeUsers: number;
  annualCap: number;

  // 풀
  rewardPool: number;
  d2eBountyPool: number;

  // 보상 유출
  monthlyL2E: number;
  monthlyL2EFree: number;   // 무료 유저 L2E (풀 유출만, 상쇄 없음)
  monthlyL2EPaid: number;   // 유료 유저 L2E
  monthlyCreator: number;
  monthlyD2E: number;

  // 소각 유입 (BurnRecycle 대상)
  monthlySubscription: number;
  monthlyHeShe: number;
  monthlyLive: number;
  monthlyPremium: number;
  monthlyBuybackBurn: number;

  // 누적
  totalDistributed: number;
  totalBurned: number;
  totalRecycled: number;

  // Vesting 해제
  vestingUnlocked: number;

  // 지표
  poolHealthPct: number;
  effectiveSupply: number;
  netMonthlyFlow: number;
}

function simulate(scenario: GNDKScenario): MonthlySnapshot[] {
  const snapshots: MonthlySnapshot[] = [];
  paidHistory.length = 0; // 시나리오별 초기화

  let rewardPool = REWARD_POOL;
  let d2eBountyPool = 0;
  let totalDistributed = 0;
  let totalBurned = 0;
  let totalRecycled = 0;
  let vestingUnlocked = 0;

  // 누적 등록 유저 추적 (Dynamic Halving Phase 판정용)
  // MAU와 별도로 "이 서비스에 한 번이라도 등록한 전체 유저"
  let cumulativeRegistered = 0;

  for (let m = 1; m <= MONTHS; m++) {
    const mau = scenario.totalMAU(m);
    const paidUsers = Math.round(mau * scenario.paidRatio(m));
    const freeUsers = mau - paidUsers;

    // 누적 등록 유저 ≈ MAU / 활성률 (추정, 이탈 포함)
    // 보수적으로 MAU × 1.5 ~ 2.0으로 추정
    cumulativeRegistered = Math.round(mau * 1.8);
    const { phase, cap: annualCap } = getAnnualCap(cumulativeRegistered);
    const monthlyCap = annualCap / 12;

    // ─── Vesting 해제 ───
    let monthlyVesting = 0;
    if (m >= 13 && m <= 24) {
      monthlyVesting += (EARLY_CONTRIB + PRIVATE_SALE) / 12;
    }
    if (m >= 13 && m <= 36) {
      monthlyVesting += TEAM_ADVISOR / 24;
    }
    vestingUnlocked = Math.min(
      vestingUnlocked + monthlyVesting,
      EARLY_CONTRIB + PRIVATE_SALE + TEAM_ADVISOR
    );

    // ─── L2E 보상 (생태계 보상 풀에서 유출) ───
    let monthlyL2EPaid: number;
    let monthlyL2EFree: number = 0;

    if (scenario.pointThreshold) {
      // ═══ 포인트 전환 임계값 모델 (Section 4.4) ═══
      const pt = scenario.pointThreshold;
      const paidReachRate = calcThresholdReachRate(
        pt.paidMonthlyPoints, pt.conversionThreshold, pt.expiryMonths
      );
      const freeReachRate = calcThresholdReachRate(
        pt.freeMonthlyPoints, pt.conversionThreshold, pt.expiryMonths
      );

      // 임계값 도달한 유저만 GNDK 전환
      monthlyL2EPaid = paidUsers * monthlyCap * paidReachRate;
      if (scenario.freeUsersEarnL2E) {
        monthlyL2EFree = freeUsers * monthlyCap * freeReachRate;
      }
    } else {
      // ═══ 레거시 모델 (하드코딩 참여율) ═══
      monthlyL2EPaid = paidUsers * monthlyCap * scenario.paidL2EParticipation;
      if (scenario.freeUsersEarnL2E) {
        monthlyL2EFree = freeUsers * monthlyCap * scenario.freeL2EParticipation;
      }
    }

    let monthlyL2E = monthlyL2EPaid + monthlyL2EFree;

    // 풀 부족 시 비례 제한
    if (monthlyL2E > rewardPool) {
      const ratio = rewardPool / monthlyL2E;
      monthlyL2EPaid *= ratio;
      monthlyL2EFree *= ratio;
      monthlyL2E = Math.max(0, rewardPool);
    }

    // ─── 크리에이터 보상 (생태계 보상 풀에서 유출) ───
    let monthlyCreator = scenario.creatorRewards(m);
    if (monthlyCreator > rewardPool - monthlyL2E) {
      monthlyCreator = Math.max(0, rewardPool - monthlyL2E);
    }

    rewardPool -= (monthlyL2E + monthlyCreator);
    totalDistributed += (monthlyL2E + monthlyCreator);

    // ─── 서비스 결제 → BurnRecycle ───
    // ※ He/She, 프리미엄은 유료 유저 기준, 라이브는 전체(무료도 일부 참여)
    const monthlySubscription = calcSubscriptionBurn(m, scenario);
    const monthlyHeShe = paidUsers * scenario.heSheSpending(m);
    const monthlyLive = mau * scenario.liveClassSpending(m) * 0.3; // 라이브: MAU 30%가 소비
    const monthlyPremium = paidUsers * scenario.premiumSpending(m);

    const totalServicePayment = monthlySubscription + monthlyHeShe + monthlyLive + monthlyPremium;

    // BurnRecycle 실행
    const serviceBurned = totalServicePayment * BURN_RATIO;
    const serviceRecycled = totalServicePayment * (1 - BURN_RATIO);

    totalBurned += serviceBurned;
    totalRecycled += serviceRecycled;
    rewardPool += serviceRecycled;  // 50%가 풀로 복귀

    // ─── D2E B2B 매출 처리 ───
    // 매출의 40% → Buyback & Burn (시장 매입 후 소각)
    // 매출의 30% → D2E Bounty Pool 리사이클
    // 매출의 30% → 운영비 (시뮬레이션 외)
    const d2eMonthlyRevenue = scenario.d2eRevenue(m);
    // $1 peg 기준으로 GNDK 환산
    const buybackBurn = d2eMonthlyRevenue * 0.4;
    const d2ePoolRefill = d2eMonthlyRevenue * 0.3;

    totalBurned += buybackBurn;
    d2eBountyPool += d2ePoolRefill;

    // ─── D2E 보상 분배 (D2E Bounty Pool에서) ───
    // D2E는 L2E 한도와 독립, 미션 기반
    let monthlyD2E = 0;
    if (d2eBountyPool > 0 && m >= 18) {
      // D2E 시작 후 풀의 10%를 월간 분배 (보수적)
      monthlyD2E = Math.min(d2eBountyPool * 0.1, d2eBountyPool);
      d2eBountyPool -= monthlyD2E;
      totalDistributed += monthlyD2E;
    }

    // ─── 스냅샷 ───
    const netMonthlyFlow = serviceRecycled - monthlyL2E - monthlyCreator;

    const effectiveSupply = TOTAL_SUPPLY - totalBurned;

    snapshots.push({
      month: m,
      phase,
      mau,
      paidUsers,
      freeUsers,
      annualCap,
      rewardPool: Math.round(rewardPool),
      d2eBountyPool: Math.round(d2eBountyPool),
      monthlyL2E: Math.round(monthlyL2E),
      monthlyL2EFree: Math.round(monthlyL2EFree),
      monthlyL2EPaid: Math.round(monthlyL2EPaid),
      monthlyCreator: Math.round(monthlyCreator),
      monthlyD2E: Math.round(monthlyD2E),
      monthlySubscription: Math.round(monthlySubscription),
      monthlyHeShe: Math.round(monthlyHeShe),
      monthlyLive: Math.round(monthlyLive),
      monthlyPremium: Math.round(monthlyPremium),
      monthlyBuybackBurn: Math.round(buybackBurn),
      totalDistributed: Math.round(totalDistributed),
      totalBurned: Math.round(totalBurned),
      totalRecycled: Math.round(totalRecycled),
      vestingUnlocked: Math.round(vestingUnlocked),
      poolHealthPct: Math.round(rewardPool / REWARD_POOL * 10000) / 100,
      effectiveSupply: Math.round(effectiveSupply),
      netMonthlyFlow: Math.round(netMonthlyFlow),
    });
  }

  return snapshots;
}

// ═══════════════════════════════════════════════════════════════
// 결과 출력
// ═══════════════════════════════════════════════════════════════

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return n.toString();
}

function printResults(scenario: GNDKScenario, snapshots: MonthlySnapshot[]) {
  console.log("\n" + "═".repeat(120));
  console.log(`  ${scenario.name}`);
  console.log(`  ${scenario.description}`);
  console.log("═".repeat(120));

  const milestones = [3, 6, 12, 18, 24, 36, 48, 60];

  // 테이블 1: 유저 & 풀 상태
  console.log("\n  [유저 & 풀 상태]");
  console.log("  ┌───────┬──────┬────────┬────────┬────────┬──────────────┬────────────┬──────────────┐");
  console.log("  │ Month │ Ph.  │  MAU   │  유료   │  무료   │  RewardPool  │  Pool HP%  │ 순유출(+유입) │");
  console.log("  ├───────┼──────┼────────┼────────┼────────┼──────────────┼────────────┼──────────────┤");

  for (const m of milestones) {
    if (m > MONTHS) break;
    const s = snapshots[m - 1];
    const flowSign = s.netMonthlyFlow >= 0 ? "+" : "";
    console.log(
      `  │ ${String(s.month).padStart(3)}M  │  ${s.phase}   │ ${fmt(s.mau).padStart(6)} │ ${fmt(s.paidUsers).padStart(6)} │ ${fmt(s.freeUsers).padStart(6)} │ ${fmt(s.rewardPool).padStart(12)} │ ${String(s.poolHealthPct).padStart(8)}%  │ ${(flowSign + fmt(s.netMonthlyFlow)).padStart(12)} │`
    );
  }
  console.log("  └───────┴──────┴────────┴────────┴────────┴──────────────┴────────────┴──────────────┘");

  // 테이블 2: L2E 유출 (무료 vs 유료) + 소각 유입
  console.log("\n  [월별 L2E 유출 (무료/유료) vs 소각 유입]");
  console.log("  ┌───────┬────────────┬────────────┬──────────┬──────────┬──────────┬──────────┬────────┐");
  console.log("  │ Month │ L2E(무료)   │ L2E(유료)   │  수강권   │  He/She  │  라이브   │ 프리미엄  │ D2E소각 │");
  console.log("  ├───────┼────────────┼────────────┼──────────┼──────────┼──────────┼──────────┼────────┤");

  for (const m of milestones) {
    if (m > MONTHS) break;
    const s = snapshots[m - 1];
    console.log(
      `  │ ${String(s.month).padStart(3)}M  │ ${fmt(s.monthlyL2EFree).padStart(10)} │ ${fmt(s.monthlyL2EPaid).padStart(10)} │ ${fmt(s.monthlySubscription).padStart(8)} │ ${fmt(s.monthlyHeShe).padStart(8)} │ ${fmt(s.monthlyLive).padStart(8)} │ ${fmt(s.monthlyPremium).padStart(8)} │ ${fmt(s.monthlyBuybackBurn).padStart(6)} │`
    );
  }
  console.log("  └───────┴────────────┴────────────┴──────────┴──────────┴──────────┴──────────┴────────┘");

  // 풀 고갈 시점
  const depletionMonth = snapshots.findIndex(s => s.rewardPool <= 0);
  if (depletionMonth >= 0) {
    const s = snapshots[depletionMonth];
    console.log(`\n  ⚠️  풀 고갈: ${s.month}개월차 (MAU ${fmt(s.mau)}, 유료 ${fmt(s.paidUsers)}, 무료 ${fmt(s.freeUsers)})`);
  } else {
    const last = snapshots[snapshots.length - 1];
    console.log(`\n  ✅  5년 후 풀 건전: ${fmt(last.rewardPool)} GNDK 잔여 (${last.poolHealthPct}%)`);
  }

  // 핵심 지표
  const last = snapshots[snapshots.length - 1];
  console.log(`\n  📊 5년차 최종:`);
  console.log(`     MAU:           ${fmt(last.mau)} (유료 ${fmt(last.paidUsers)} + 무료 ${fmt(last.freeUsers)})`);
  console.log(`     Phase:         ${last.phase} (연간캡 ${last.annualCap} GNDK)`);
  console.log(`     누적 소각:     ${fmt(last.totalBurned)} (실효 공급 ${fmt(last.effectiveSupply)})`);
  console.log(`     누적 리사이클: ${fmt(last.totalRecycled)}`);
  console.log(`     누적 분배:     ${fmt(last.totalDistributed)}`);

  // 무료 유저 L2E 비중 분석
  const avgFreeL2E = snapshots.slice(-12).reduce((s, x) => s + x.monthlyL2EFree, 0) / 12;
  const avgPaidL2E = snapshots.slice(-12).reduce((s, x) => s + x.monthlyL2EPaid, 0) / 12;
  const avgTotalL2E = avgFreeL2E + avgPaidL2E;
  const freePct = avgTotalL2E > 0 ? Math.round(avgFreeL2E / avgTotalL2E * 100) : 0;

  console.log(`\n  🆓 무료 유저 L2E 비중 (최근 12개월): ${freePct}% (월 ${fmt(Math.round(avgFreeL2E))} GNDK)`);
  console.log(`  💰 유료 유저 L2E 비중: ${100 - freePct}% (월 ${fmt(Math.round(avgPaidL2E))} GNDK)`);

  // 리사이클 커버률
  const avgMonthlyRecycle = snapshots.slice(-12).reduce((s, x) =>
    s + (x.monthlySubscription + x.monthlyHeShe + x.monthlyLive + x.monthlyPremium) * 0.5, 0) / 12;
  const coverageRatio = avgTotalL2E > 0 ? Math.round(avgMonthlyRecycle / avgTotalL2E * 100) : 0;
  console.log(`\n  🔄 리사이클/L2E 커버률: ${coverageRatio}%`);
  if (coverageRatio >= 100) {
    console.log(`     → 소비처가 L2E를 완전 커버! 풀이 자가 지속 가능`);
  } else if (coverageRatio >= 50) {
    console.log(`     → 소비처가 L2E의 ${coverageRatio}%를 커버. 추가 소비처 권장`);
  } else {
    console.log(`     → ⚠️ 소비처가 L2E의 ${coverageRatio}%만 커버. 무료 유저 비중 때문에 위험!`);
  }

  // 무료 유저 L2E = 순수 비용 (상쇄 없음)
  if (freePct > 30) {
    console.log(`\n  ⚠️ 무료 유저 L2E가 전체의 ${freePct}% — 풀 유출 중 ${freePct}%는 상쇄 불가`);
    console.log(`     → 무료 유저 L2E 한도 축소 또는 전환 유도 전략 필요`);
  }

  // 포인트 임계값 모델 상세
  if (scenario.pointThreshold) {
    const pt = scenario.pointThreshold;
    const paidRate = calcThresholdReachRate(pt.paidMonthlyPoints, pt.conversionThreshold, pt.expiryMonths);
    const freeRate = calcThresholdReachRate(pt.freeMonthlyPoints, pt.conversionThreshold, pt.expiryMonths);
    console.log(`\n  🎯 포인트 전환 임계값 분석 (Section 4.4):`);
    console.log(`     임계값: ${pt.conversionThreshold.toLocaleString()}pt | 소멸: ${pt.expiryMonths}개월 | 일일캡: 100pt`);
    console.log(`     유료 월 평균: ${pt.paidMonthlyPoints}pt → ${pt.expiryMonths}개월 누적 ${(pt.paidMonthlyPoints * pt.expiryMonths).toLocaleString()}pt`);
    console.log(`     무료 월 평균: ${pt.freeMonthlyPoints}pt → ${pt.expiryMonths}개월 누적 ${(pt.freeMonthlyPoints * pt.expiryMonths).toLocaleString()}pt`);
    console.log(`     유료 임계값 도달률: ${(paidRate * 100).toFixed(1)}%`);
    console.log(`     무료 임계값 도달률: ${(freeRate * 100).toFixed(1)}%`);

    // 등급별 도달 여부 상세
    const tiers = [
      { name: '헤비(5%)', paidMul: 3.5, freeMul: 3.5 },
      { name: '활발(15%)', paidMul: 1.9, freeMul: 1.9 },
      { name: '보통(30%)', paidMul: 1.0, freeMul: 1.0 },
      { name: '라이트(25%)', paidMul: 0.32, freeMul: 0.32 },
      { name: '최하위(25%)', paidMul: 0.07, freeMul: 0.07 },
    ];
    console.log(`     ┌────────────┬──────────────┬──────────────┐`);
    console.log(`     │ 등급       │ 유료 누적    │ 무료 누적    │`);
    console.log(`     ├────────────┼──────────────┼──────────────┤`);
    for (const t of tiers) {
      const pAccum = Math.round(pt.paidMonthlyPoints * t.paidMul * pt.expiryMonths);
      const fAccum = Math.round(pt.freeMonthlyPoints * t.freeMul * pt.expiryMonths);
      const pMark = pAccum >= pt.conversionThreshold ? '✅' : '❌';
      const fMark = fAccum >= pt.conversionThreshold ? '✅' : '❌';
      console.log(`     │ ${t.name.padEnd(10)} │ ${String(pAccum).padStart(6)}pt ${pMark} │ ${String(fAccum).padStart(6)}pt ${fMark} │`);
    }
    console.log(`     └────────────┴──────────────┴──────────────┘`);

    // 풀 보존 효과 추정
    const theoreticalFreeL2E = snapshots.slice(-12).reduce((s, x) => s + x.freeUsers, 0) / 12 *
      (getAnnualCap(snapshots[snapshots.length - 1].mau * 1.8).cap / 12) * 0.5;
    const actualFreeL2E = avgFreeL2E;
    const savedPct = theoreticalFreeL2E > 0
      ? Math.round((1 - actualFreeL2E / theoreticalFreeL2E) * 100)
      : 0;
    console.log(`     풀 보존 효과: 무료 유저 L2E ${savedPct}% 자연 차단 (임계값 미달 소멸)`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 크로스 시나리오 비교
// ═══════════════════════════════════════════════════════════════

function printComparison(allResults: { scenario: GNDKScenario; snapshots: MonthlySnapshot[] }[]) {
  console.log("\n\n" + "═".repeat(100));
  console.log("  📋 GNDK 시나리오 비교 요약");
  console.log("═".repeat(100));

  console.log("  ┌──────────────────────────────────────┬────────┬──────────┬──────────┬──────────┬────────┬────────┐");
  console.log("  │ Scenario                             │ 풀고갈  │ 5Y 풀잔여 │ 누적소각  │ 누적분배 │ 커버률  │ 무료%  │");
  console.log("  ├──────────────────────────────────────┼────────┼──────────┼──────────┼──────────┼────────┼────────┤");

  for (const { scenario, snapshots } of allResults) {
    const depletion = snapshots.findIndex(s => s.rewardPool <= 0);
    const last = snapshots[snapshots.length - 1];

    const depStr = depletion >= 0 ? `${snapshots[depletion].month}M` : "안전";
    const remainStr = depletion >= 0 ? "0" : fmt(last.rewardPool);

    const avgL2E = snapshots.slice(-12).reduce((s, x) => s + x.monthlyL2E, 0) / 12;
    const avgRecycle = snapshots.slice(-12).reduce((s, x) =>
      s + (x.monthlySubscription + x.monthlyHeShe + x.monthlyLive + x.monthlyPremium) * 0.5, 0) / 12;
    const coverage = avgL2E > 0 ? Math.round(avgRecycle / avgL2E * 100) : 0;

    const avgFreeL2E = snapshots.slice(-12).reduce((s, x) => s + x.monthlyL2EFree, 0) / 12;
    const freePct = avgL2E > 0 ? Math.round(avgFreeL2E / avgL2E * 100) : 0;

    const nameShort = scenario.name.substring(0, 38).padEnd(38);
    console.log(
      `  │ ${nameShort} │ ${depStr.padStart(5)}  │ ${remainStr.padStart(8)} │ ${fmt(last.totalBurned).padStart(8)} │ ${fmt(last.totalDistributed).padStart(8)} │ ${String(coverage).padStart(4)}%  │ ${String(freePct).padStart(4)}%  │`
    );
  }

  console.log("  └──────────────────────────────────────┴────────┴──────────┴──────────┴──────────┴────────┴────────┘");

  // ─── 핵심 인사이트 ───
  console.log("\n  💡 핵심 인사이트:");
  console.log("  ──────────────────────────────────────────────────────────────────────");
  console.log("  1. [현실] 전환율 7% = 무료 93%가 L2E 받고 돌려주는 건 0");
  console.log("     → 시나리오 A: 수강권만으로는 커버 불가 → 풀 지속 감소");
  console.log("     → 무료 유저 L2E가 전체 유출의 90%+ 차지");
  console.log("");
  console.log("  2. [타임라인] He/She + Live + Creator 풀스펙 시점이 생사를 가름");
  console.log("     → 시나리오 B(He/She 6M): 소비처가 조기 출시되면 풀 안정화");
  console.log("     → 시나리오 D(풀스펙 24M): 2년 걸리면 풀 상당량 손실 후 회복");
  console.log("     → ⏰ 권장: He/She는 TGE 동시 or +3개월, 라이브는 +6~9개월");
  console.log("");
  console.log("  3. [방어 전략 비교: F(하드리밋) vs G/H/I/J(포인트 임계값)]");
  console.log("     F: 무료 L2E 30% 하드리밋 → 효과적이나 차별적 (유저 반감)");
  console.log("     G: 500pt/3M  → 유료 보통 1개월 도달, 무료 활발 3개월 도달");
  console.log("     H: 1500pt/3M → 유료 보통~활발 3개월, 무료 헤비만 도달 (강한 게이트)");
  console.log("     I: 1500pt/6M → H와 같은 임계값 + 소멸 여유 → 무료 활발도 기회");
  console.log("     J: 3000pt/6M → 높은 허들, 유료 활발급만 도달");
  console.log("     → ⭐ 동일 규칙이므로 차별 논란 없음 (핵심 장점)");
  console.log("     → 캐주얼 유저: 포인트 소멸 → 풀 보존");
  console.log("     → 활발 무료 유저: GNDK 획득 가능 → 앱 충성도 유지");
  console.log("");
  console.log("  4. [소비처별 효과]");
  console.log("     → He/She 코스메틱: 유료 유저의 반복 소비 (매월 $5~15)");
  console.log("     → 라이브 클래스룸: 팬이코노미 (수퍼챗, 선물) — 고액 소비");
  console.log("     → 크리에이터 콘텐츠: 프리미엄 구독 — 안정적 반복 수입");
  console.log("     → 세 가지가 합쳐져야 무료 93%의 유출을 상쇄 가능");
  console.log("");
  console.log("  5. [풀스펙 출시 타임라인 권장]");
  console.log("     → TGE:     수강권 GNDK 결제 + 기본 L2E");
  console.log("     → TGE+3M:  He/She AI 친구 출시 (코스메틱 시즌1)");
  console.log("     → TGE+6M:  라이브 클래스룸 베타 (팬 경제 시작)");
  console.log("     → TGE+9M:  크리에이터 프리미엄 콘텐츠 구독");
  console.log("     → TGE+12M: 풀스펙 완비 + D2E 베타 (B2B 데이터 수익)");
  console.log("");
  console.log("  6. [포인트 임계값 최적값 권장 — 실제 앱 포인트 기반]");
  console.log("     일일 캡: 100pt | 유료 평균 ~620pt/월 | 무료 평균 ~185pt/월");
  console.log("     → 임계값: 1,000~1,500pt (유료 2~3개월, 무료 활발 6개월)");
  console.log("     → 소멸기간: 3~6개월 (짧으면 이탈, 길면 효과 감소)");
  console.log("     → 결합 전략: 임계값 + 풀스펙 소비처 = 최적 풀 건전성");
  console.log("     → 유료 보통 유저가 '3개월 꾸준히 하면 GNDK 받는다' = 최적 유인");
}

// ═══════════════════════════════════════════════════════════════
// 실행
// ═══════════════════════════════════════════════════════════════

console.log("╔════════════════════════════════════════════════════════════════════════╗");
console.log("║          GNDK 토큰 라이프사이클 시뮬레이션 (5년, 월 단위)              ║");
console.log("╠════════════════════════════════════════════════════════════════════════╣");
console.log("║  Total Supply:    1,000,000,000 GNDK (10억, 고정)                    ║");
console.log("║  RewardPool:        300,000,000 (30%) — L2E + Creator                ║");
console.log("║  Foundation:        250,000,000 (25%, 즉시)                          ║");
console.log("║  Marketing:         100,000,000 (10%)                                ║");
console.log("║  Partnership:        50,000,000 (5%)                                 ║");
console.log("║  Donation:           50,000,000 (5%)                                 ║");
console.log("║  Early+Private:     200,000,000 (20%, 1Y lock + 1Y linear)           ║");
console.log("║  Team/Advisor:       50,000,000 (5%, 1Y lock + 2Y linear)            ║");
console.log("║  BurnRecycle:       50% destroy / 50% recycle to pool                ║");
console.log("║  D2E B2B:           40% buyback burn / 30% D2E pool / 30% ops        ║");
console.log("║  Dynamic Halving:   70→40→15→3 GNDK/user/year                        ║");
console.log("║  $1 Peg:            앱 내 1 GNDK = 최소 $1                            ║");
console.log("╚════════════════════════════════════════════════════════════════════════╝");

const allResults: { scenario: GNDKScenario; snapshots: MonthlySnapshot[] }[] = [];

for (const scenario of scenarios) {
  const snapshots = simulate(scenario);
  allResults.push({ scenario, snapshots });
  printResults(scenario, snapshots);
}

printComparison(allResults);
