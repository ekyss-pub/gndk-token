use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::*;
use crate::errors::GndkError;
use crate::state::*;

// ═══════════════════════════════════════════════════════════════
// transfer_from_d2e_pool — D2E Bounty Pool에서 사용자에게 전송
// ═══════════════════════════════════════════════════════════════
//
// L2E와 독립된 한도 체계
// D2E 모듈만 호출 가능 (pool_type == D2E)

pub fn handler(ctx: Context<TransferFromD2EPool>, amount: u64) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.global_pause, GndkError::ProgramPaused);

    // 1. 모듈 검증
    let module = &mut ctx.accounts.module_account;
    require!(module.is_active, GndkError::ModuleInactive);
    require!(!module.module_pause, GndkError::ModulePaused);
    require!(module.pool_type == POOL_TYPE_D2E, GndkError::PoolTypeMismatch);

    // 2. 모듈 일일 한도
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

    // 3. 유저 D2E 연간 한도 (module.annual_limit 기준, Dynamic Halving과 독립)
    let user_account = &mut ctx.accounts.user_account;
    let current_year = super::register_user::get_current_year(config.tge_timestamp)?;

    if current_year > user_account.last_reset_year {
        user_account.l2e_annual_claimed = 0;
        user_account.d2e_annual_claimed = 0;
        user_account.last_reset_year = current_year;
    }

    if module.annual_limit > 0 {
        let new_d2e = user_account.d2e_annual_claimed
            .checked_add(amount)
            .ok_or(GndkError::Overflow)?;
        require!(new_d2e <= module.annual_limit, GndkError::D2EAnnualLimitExceeded);
        user_account.d2e_annual_claimed = new_d2e;
    } else {
        user_account.d2e_annual_claimed = user_account.d2e_annual_claimed
            .checked_add(amount)
            .ok_or(GndkError::Overflow)?;
    }

    // 4. 토큰 전송
    let transfer_amount = amount
        .checked_mul(DECIMALS_FACTOR)
        .ok_or(GndkError::Overflow)?;

    let mint_key = config.mint.key();
    let seeds = &[
        b"d2e_pool".as_ref(),
        mint_key.as_ref(),
        &[ctx.accounts.d2e_pool_authority.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.d2e_pool_ata.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.user_ata.to_account_info(),
            authority: ctx.accounts.d2e_pool_authority.to_account_info(),
        },
        signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, transfer_amount, TOKEN_DECIMALS)?;

    // 5. 통계 업데이트
    user_account.total_earned = user_account.total_earned
        .checked_add(amount)
        .ok_or(GndkError::Overflow)?;

    let config = &mut ctx.accounts.config;
    config.total_d2e_distributed = config.total_d2e_distributed
        .checked_add(amount)
        .ok_or(GndkError::Overflow)?;

    msg!(
        "D2E Transfer: {} GNDK via {} to {}",
        amount, module.name, user_account.owner
    );
    Ok(())
}

#[derive(Accounts)]
pub struct TransferFromD2EPool<'info> {
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
        seeds = [b"d2e_pool", config.mint.as_ref()],
        bump = d2e_pool_authority.bump,
    )]
    pub d2e_pool_authority: Account<'info, D2EPoolAuthority>,

    #[account(mut)]
    pub d2e_pool_ata: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"user", user_account.owner.as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(mut)]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,

    /// 모듈의 PDA 또는 admin이 서명
    pub caller: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}
