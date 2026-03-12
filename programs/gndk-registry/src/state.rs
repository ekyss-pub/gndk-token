use anchor_lang::prelude::*;

// ═══════════════════════════════════════════════════════════════
// GNDK Registry — Account State
// ═══════════════════════════════════════════════════════════════

/// 글로벌 설정 PDA
/// Seeds: ["config"]
#[account]
pub struct ConfigAccount {
    pub admin: Pubkey,                    // 32 — 관리자 (multi-sig 향후)
    pub oracle: Pubkey,                   // 32 — 오라클 (KYC 검증, 유저 등록)
    pub mint: Pubkey,                     // 32 — GNDK 토큰 Mint
    pub current_phase: u8,                // 1  — 0=Phase1, 1=Phase2, 2=Phase3, 3=Phase4
    pub total_registered_users: u64,      // 8  — KYC 인증 누적 등록 수
    pub global_pause: bool,               // 1  — 전체 일시 중단
    pub total_distributed: u64,           // 8  — 누적 분배량 (L2E + admin)
    pub total_d2e_distributed: u64,       // 8  — 누적 D2E 분배량
    pub total_burned: u64,                // 8  — 누적 소각량
    pub total_recycled: u64,              // 8  — 누적 리사이클량
    pub tge_timestamp: i64,               // 8  — TGE 시점 (연간 리셋 기준)
    pub bump: u8,                         // 1
}
// space: 8 + 32*3 + 1 + 8 + 1 + 8*4 + 8 + 1 = 147

impl ConfigAccount {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 1 + 8 + 1 + 8 + 8 + 8 + 8 + 8 + 1; // 147
}

/// 사용자 계정 PDA
/// Seeds: ["user", user_pubkey]
#[account]
pub struct UserAccount {
    pub owner: Pubkey,                    // 32
    pub l2e_annual_claimed: u64,          // 8  — 현재 연도 L2E 누적 수령
    pub d2e_annual_claimed: u64,          // 8  — 현재 연도 D2E 누적 수령
    pub total_earned: u64,                // 8  — 전체 기간 누적 수령
    pub last_reset_year: u64,             // 8  — 마지막 리셋 연도
    pub registered_at: i64,               // 8  — 등록 시점 timestamp
    pub bump: u8,                         // 1
}
// space: 8 + 32 + 8*4 + 8 + 1 = 81

impl UserAccount {
    pub const SIZE: usize = 8 + 32 + 8 + 8 + 8 + 8 + 8 + 1; // 81
}

/// 모듈 계정 PDA
/// Seeds: ["module", module_program_id]
#[account]
pub struct ModuleAccount {
    pub program_id: Pubkey,               // 32 — 모듈 프로그램 주소
    pub name: String,                     // 4 + 32 max — 모듈 이름
    pub pool_type: u8,                    // 1  — 0=L2E RewardPool, 1=D2E BountyPool
    pub daily_limit: u64,                 // 8  — 일일 분배 한도 (0 = 무제한)
    pub daily_used: u64,                  // 8  — 오늘 사용량
    pub last_reset_day: u64,              // 8  — 마지막 리셋 일자
    pub annual_limit: u64,                // 8  — 모듈 자체 연간 한도 (0 = Phase cap만 적용)
    pub is_active: bool,                  // 1  — 활성 상태
    pub module_pause: bool,               // 1  — 모듈별 개별 pause
    pub bump: u8,                         // 1
}
// space: 8 + 32 + (4+32) + 1 + 8*4 + 1 + 1 + 1 = 112

impl ModuleAccount {
    pub const SIZE: usize = 8 + 32 + (4 + 32) + 1 + 8 + 8 + 8 + 8 + 1 + 1 + 1; // 112
}

/// RewardPool Authority PDA (L2E)
/// Seeds: ["reward_pool", mint]
#[account]
pub struct RewardPoolAuthority {
    pub bump: u8,                         // 1
}

impl RewardPoolAuthority {
    pub const SIZE: usize = 8 + 1; // 9
}

/// D2E Bounty Pool Authority PDA
/// Seeds: ["d2e_pool", mint]
#[account]
pub struct D2EPoolAuthority {
    pub bump: u8,                         // 1
}

impl D2EPoolAuthority {
    pub const SIZE: usize = 8 + 1; // 9
}

/// BurnRecycle 통계 PDA
/// Seeds: ["burn_stats"]
#[account]
pub struct BurnStats {
    pub total_burned: u64,                // 8
    pub total_recycled: u64,              // 8
    pub bump: u8,                         // 1
}

impl BurnStats {
    pub const SIZE: usize = 8 + 8 + 8 + 1; // 25
}

// ─── Pool Type 상수 ───

pub const POOL_TYPE_L2E: u8 = 0;
pub const POOL_TYPE_D2E: u8 = 1;
