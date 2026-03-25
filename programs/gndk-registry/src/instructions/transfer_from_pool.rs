use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::*;
use crate::errors::GndkError;
use crate::state::*;

// ═══════════════════════════════════════════════════════════════
// transfer_from_pool — L2E RewardPool에서 사용자에게 전송
// ═══════════════════════════════════════════════════════════════
//
// 호출 모델: admin/oracle 권한 + 등록된 활성 모듈 컨텍스트 필수
// 모듈(L2E 등)이 CPI로 호출하며, caller는 모듈의 oracle/admin이 전달됨
// 검증:
//   1. caller가 config.admin 또는 config.oracle인지 확인
//   2. 글로벌 pause + 모듈 pause
//   3. 모듈 등록 + 활성 + pool_type == L2E
//   4. 모듈 일일 한도
//   5. 유저 L2E 연간 한도 (Dynamic Halving Phase cap)
//   6. 토큰 전송

pub fn handler(ctx: Context<TransferFromPool>, amount: u64) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.global_pause, GndkError::ProgramPaused);

    // 0. caller 권한 검증 (C-1 fix: admin 또는 oracle만 호출 가능)
    let caller_key = ctx.accounts.caller.key();
    require!(
        caller_key == config.admin || caller_key == config.oracle,
        GndkError::Unauthorized
    );

    // 1. 모듈 검증
    let module = &mut ctx.accounts.module_account;
    require!(module.is_active, GndkError::ModuleInactive);
    require!(!module.module_pause, GndkError::ModulePaused);
    require!(module.pool_type == POOL_TYPE_L2E, GndkError::PoolTypeMismatch);

    // 2. 모듈 일일 한도 (daily_limit > 0일 때만)
    if module.daily_limit > 0 {
        let current_day = super::register_user::get_current_day()?;
        if current_day > module.last_reset_day {
            module.daily_used = 0;
            module.last_reset_day = current_day;
        }
        let new_daily = module.daily_used
            .checked_add(amount)
            .ok_or(GndkError::Overflow)?;
        require!(new_daily <= module.daily_limit, GndkError::DailyLimitExceeded);
        module.daily_used = new_daily;
    }

    // 3. 유저 L2E 연간 한도 (Dynamic Halving)
    let user_account = &mut ctx.accounts.user_account;
    let current_year = super::register_user::get_current_year(config.tge_timestamp)?;

    if current_year > user_account.last_reset_year {
        user_account.l2e_annual_claimed = 0;
        user_account.d2e_annual_claimed = 0;
        user_account.last_reset_year = current_year;
    }

    let phase_cap = PHASE_CAPS[config.current_phase as usize];
    let new_l2e = user_account.l2e_annual_claimed
        .checked_add(amount)
        .ok_or(GndkError::Overflow)?;
    require!(new_l2e <= phase_cap, GndkError::L2EAnnualLimitExceeded);

    // 4. 토큰 전송 (GNDK 단위 → lamports)
    let transfer_amount = amount
        .checked_mul(DECIMALS_FACTOR)
        .ok_or(GndkError::Overflow)?;

    let mint_key = config.mint.key();
    let seeds = &[
        b"reward_pool".as_ref(),
        mint_key.as_ref(),
        &[ctx.accounts.pool_authority.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.reward_pool_ata.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.user_ata.to_account_info(),
            authority: ctx.accounts.pool_authority.to_account_info(),
        },
        signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, transfer_amount, TOKEN_DECIMALS)?;

    // 5. 통계 업데이트
    user_account.l2e_annual_claimed = new_l2e;
    user_account.total_earned = user_account.total_earned
        .checked_add(amount)
        .ok_or(GndkError::Overflow)?;

    let config = &mut ctx.accounts.config;
    config.total_distributed = config.total_distributed
        .checked_add(amount)
        .ok_or(GndkError::Overflow)?;

    msg!(
        "L2E Transfer: {} GNDK via {} to {} (phase={}, cap={})",
        amount, module.name, user_account.owner,
        config.current_phase + 1, phase_cap
    );
    Ok(())
}

#[derive(Accounts)]
pub struct TransferFromPool<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ConfigAccount>,

    #[account(
        mut,
        seeds = [b"module", module_account.program_id.as_ref()],
        bump = module_account.bump,
    )]
    pub module_account: Account<'info, ModuleAccount>,

    #[account(
        seeds = [b"reward_pool", config.mint.as_ref()],
        bump = pool_authority.bump,
    )]
    pub pool_authority: Account<'info, RewardPoolAuthority>,

    /// C-7 fix: reward_pool_ata의 authority + mint 검증
    #[account(
        mut,
        token::mint = mint,
        token::authority = pool_authority,
    )]
    pub reward_pool_ata: InterfaceAccount<'info, TokenAccount>,

    /// GSA-07 fix: mint가 config.mint과 일치하는지 검증
    #[account(constraint = mint.key() == config.mint @ GndkError::MintMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"user", user_account.owner.as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,

    /// C-2 fix: user_ata가 실제 user_account.owner의 토큰 계정인지 + mint 일치 검증
    #[account(
        mut,
        token::mint = mint,
        token::authority = user_account.owner,
    )]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,

    /// C-1 fix: admin 또는 oracle만 호출 가능 (handler에서 검증)
    pub caller: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}
