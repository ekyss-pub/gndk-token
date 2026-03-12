use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::GndkError;
use crate::state::*;

// ═══════════════════════════════════════════════════════════════
// register_user — 오라클이 KYC 검증된 사용자 등록
// ═══════════════════════════════════════════════════════════════
//
// - UserAccount PDA 생성 (1회만, 중복 방지 = init constraint)
// - total_registered_users += 1
// - Dynamic Halving Phase 자동 전환 체크
// - Phase는 단방향(1→2→3→4)만 가능, 역행 불가
//
// 호출자: oracle (KYC 검증 서버) 또는 admin

pub fn handler(ctx: Context<RegisterUser>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(!config.global_pause, GndkError::ProgramPaused);

    // 오라클 또는 admin만 호출 가능
    let caller = ctx.accounts.authority.key();
    require!(
        caller == config.oracle || caller == config.admin,
        GndkError::Unauthorized
    );

    // UserAccount 초기화
    let user_account = &mut ctx.accounts.user_account;
    user_account.owner = ctx.accounts.user.key();
    user_account.l2e_annual_claimed = 0;
    user_account.d2e_annual_claimed = 0;
    user_account.total_earned = 0;
    user_account.last_reset_year = get_current_year(config.tge_timestamp)?;
    user_account.registered_at = Clock::get()?.unix_timestamp;
    user_account.bump = ctx.bumps.user_account;

    // 등록 수 증가
    config.total_registered_users = config
        .total_registered_users
        .checked_add(1)
        .ok_or(GndkError::Overflow)?;

    // Dynamic Halving: Phase 자동 전환
    let users = config.total_registered_users;
    let phase = config.current_phase;

    if phase < MAX_PHASE {
        let next_threshold = PHASE_THRESHOLDS[(phase + 1) as usize];
        if users >= next_threshold {
            config.current_phase = phase + 1;
            msg!(
                "PhaseChanged: {} → {} (users={})",
                phase + 1,
                phase + 2,
                users
            );
        }
    }

    msg!(
        "User registered: {} (total={}, phase={})",
        user_account.owner,
        config.total_registered_users,
        config.current_phase + 1
    );
    Ok(())
}

#[derive(Accounts)]
pub struct RegisterUser<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ConfigAccount>,

    #[account(
        init,
        payer = authority,
        space = UserAccount::SIZE,
        seeds = [b"user", user.key().as_ref()],
        bump,
    )]
    pub user_account: Account<'info, UserAccount>,

    /// CHECK: 등록 대상 사용자 (pubkey만 필요)
    pub user: UncheckedAccount<'info>,

    /// oracle 또는 admin
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ─── 유틸리티 ───

/// TGE 기준 연도 계산 (365일 주기)
pub fn get_current_year(tge_timestamp: i64) -> Result<u64> {
    let clock = Clock::get()?;
    let elapsed = (clock.unix_timestamp - tge_timestamp).max(0) as u64;
    Ok(elapsed / YEAR_SECONDS)
}

/// UTC 기준 일 번호
pub fn get_current_day() -> Result<u64> {
    let clock = Clock::get()?;
    Ok(clock.unix_timestamp as u64 / DAY_SECONDS)
}
