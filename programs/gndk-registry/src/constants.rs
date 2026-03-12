// ═══════════════════════════════════════════════════════════════
// GNDK Registry — Constants
// ═══════════════════════════════════════════════════════════════

/// SPL Token decimals (Solana standard: 9)
pub const TOKEN_DECIMALS: u8 = 9;

/// 1 GNDK = 10^9 lamports
pub const DECIMALS_FACTOR: u64 = 1_000_000_000;

/// BurnRecycle 소각 비율: 50% burn, 50% recycle (고정)
pub const BURN_RATIO: u64 = 50;

/// Admin 직접 분배 연간 한도 (GNDK 단위)
pub const ADMIN_ANNUAL_LIMIT: u64 = 1_000;

// ─── Dynamic Halving ───

/// Phase 전환 사용자 수 임계값
/// Phase 1→2: 100K, 2→3: 1M, 3→4: 10M
pub const PHASE_THRESHOLDS: [u64; 4] = [
    0,           // Phase 1: 0명부터 시작
    100_000,     // Phase 2: 100K users
    1_000_000,   // Phase 3: 1M users
    10_000_000,  // Phase 4: 10M users
];

/// Phase별 인당 연간 L2E 수령 한도 (GNDK 단위, decimals 미적용)
pub const PHASE_CAPS: [u64; 4] = [
    70,  // Phase 1: 70 GNDK/year
    40,  // Phase 2: 40 GNDK/year
    15,  // Phase 3: 15 GNDK/year
    3,   // Phase 4: 3 GNDK/year
];

/// 최대 Phase 인덱스
pub const MAX_PHASE: u8 = 3; // 0-indexed: Phase 1=0, Phase 4=3

/// 모듈 이름 최대 길이 (bytes)
pub const MAX_MODULE_NAME_LEN: usize = 32;

/// 연간 리셋 주기 (seconds) — 365일
pub const YEAR_SECONDS: u64 = 31_557_600; // 365.25 * 86400

/// 일일 리셋 주기 (seconds)
pub const DAY_SECONDS: u64 = 86_400;
